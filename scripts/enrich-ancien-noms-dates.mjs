// --- DATES DE CHANGEMENT DE NOM POUR LES VOIES AVEC ancien_noms ---
// Script d'entretien ponctuel : pour chaque ancien nom d'une voie "vivante" (non supprimée — les
// voies supprimées ont déjà annee_suppression, cf. scripts/enrich-rues-paris.mjs), cherche une date
// de changement de nom, par ordre de préférence :
//  1. wiki.txt (dump local de "Liste des anciens noms de voies de Paris", Wikipédia) : rapide (aucun
//     réseau), phrasé homogène ("nommée X depuis YYYY"), confidence='wikipedia'.
//  2. À défaut, la page Wikisource du Dictionnaire Lazare 1844 correspondante (titre reconstruit
//     déterministiquement depuis name+cat, ex: "rue de Lille" -> "Lille (rue de)") : prose libre de
//     1844, motifs de date moins fiables, confidence='scraped'.
// Transforme ancien_noms de string[] en {nom, annee, confidence}[]. Best-effort des deux côtés : la
// majorité des entrées n'auront pas de date exploitable, ce qui est attendu (voir meta.ancien_noms_note).
//
// À lancer APRÈS scripts/enrich-rues-paris.mjs (pas de dépendance de données, mais évite d'écrire le
// même fichier depuis deux processus en même temps).
//
// Usage : node scripts/enrich-ancien-noms-dates.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'assets', 'data', 'rues-paris-lazare-1844.json');
const WIKI_TXT_PATH = path.join(__dirname, '..', 'wiki.txt');
const UA = 'VisuGedcom-rues-paris-enrichment/1.0 (one-off maintenance script; https://github.com/Sidam31/Outils-genealogiques)';
const WIKISOURCE_BASE = 'https://fr.wikisource.org/w/api.php';
const WIKISOURCE_PAGE_PREFIX = 'Dictionnaire administratif et historique des rues de Paris et de ses monuments/';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function norm(s) {
    return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[’]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
}

// --- Source 1 : wiki.txt local (Liste des anciens noms de voies de Paris, Wikipédia) ---

const WIKI_NEW_NAME_PATTERN =
    /(?:nomm[ée]e?|devenue?|renomm[ée]e?|rebaptis[ée]e?|appel[ée]e?(?:\s+aujourd'hui)?|absorb[ée]e?\s+par)\s+(?:la\s+|le\s+|l['’])?(.+?)\s+(?:depuis|en)\s+(\d{4})/i;

async function loadWikiTxtIndex() {
    const text = await readFile(WIKI_TXT_PATH, 'utf-8');
    const index = new Map(); // nom normalisé -> { year, raw }
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*(.+?)\s*\(([^,()]+)\)\s*,?\s*(.*)$/);
        if (!m) continue;
        const [, core, catConn, rest] = m;
        if (!rest || !rest.trim()) continue;
        const oldName = `${catConn.trim()} ${core.trim()}`.trim();
        const mm = rest.match(WIKI_NEW_NAME_PATTERN);
        if (!mm) continue; // pas de date exploitable sur cette ligne
        index.set(norm(oldName), { year: parseInt(mm[2], 10), raw: rest.trim() });
    }
    return index;
}

// --- Source 2 (repli) : page Wikisource du Dictionnaire Lazare 1844 ---

const CONNECTORS = ["de la", "de l'", "de l’", "des", "du", "de", "aux", "au", "à la", "à l'", "à", "d'", "d’"];

function buildTitleCandidate(name, cat) {
    let rest = name;
    for (const w of cat.split(/\s+/)) {
        const re = new RegExp('^' + reEscape(w) + '\\s+', 'i');
        if (!re.test(rest)) return null;
        rest = rest.replace(re, '');
    }
    rest = rest.trim();
    for (const conn of CONNECTORS) {
        const endsWithApos = /['’]$/.test(conn);
        const connPattern = reEscape(conn).replace(/’/g, "['’]").replace(/'/g, "['’]");
        const re = endsWithApos ? new RegExp('^' + connPattern, 'i') : new RegExp('^' + connPattern + '\\s+', 'i');
        const m = rest.match(re);
        if (m) {
            const remainder = rest.slice(m[0].length).trim();
            if (remainder) return `${remainder} (${cat} ${conn})`;
        }
    }
    return `${rest} (${cat})`;
}

async function wikisourcePageExists(title) {
    const url = `${WIKISOURCE_BASE}?action=query&titles=${encodeURIComponent(WIKISOURCE_PAGE_PREFIX + title)}&format=json`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const data = await res.json();
    const page = Object.values(data.query?.pages || {})[0];
    return page && !('missing' in page) ? (WIKISOURCE_PAGE_PREFIX + title) : null;
}

async function resolveWikisourcePage(name, cat) {
    const primary = buildTitleCandidate(name, cat);
    if (!primary) return null;
    const candidates = [primary];
    if (primary.includes("'")) candidates.push(primary.replace(/'/g, '’'));
    else if (primary.includes('’')) candidates.push(primary.replace(/’/g, "'"));
    for (const c of candidates) {
        const found = await wikisourcePageExists(c);
        if (found) return found;
        await sleep(300);
    }
    return null;
}

async function fetchWikisourceText(title) {
    const url = `${WIKISOURCE_BASE}?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const data = await res.json();
    if (!data.parse) return null;
    return data.parse.text['*'].replace(/<[^>]+>/g, ' ').replace(/&#160;/g, ' ').replace(/\s+/g, ' ').trim();
}

const LAZARE_DATE_PATTERNS = [
    /jusqu['’]en\s+(\d{4})/i,
    /jusqu['’]à\s+(?:l['’]an\s+)?(\d{4})/i,
    /jusque\s+vers\s+(\d{4})/i,
    /depuis\s+(\d{4})/i,
    /en\s+(\d{4}),?\s+(?:elle|il|cette rue|cette avenue|ce quai|cette place|cet? impasse)?\s*(?:reçut|prit|changea)/i,
    /décret[^.]{0,40}du\s+\d{1,2}\s+\w+\s+(\d{4})/i,
    /loi[^.]{0,40}du\s+\d{1,2}\s+\w+\s+(\d{4})/i,
    /arrêté[^.]{0,40}du\s+\d{1,2}\s+\w+\s+(\d{4})/i,
];

function extractLazareDate(text, oldName) {
    const key = oldName.toLowerCase().split(/\s+/).pop();
    const idx = text.toLowerCase().indexOf(key);
    const window = idx >= 0 ? text.slice(Math.max(0, idx - 200), idx + 400) : null;
    for (const re of LAZARE_DATE_PATTERNS) {
        const m = (window && window.match(re)) || text.match(re);
        if (m) return parseInt(m[1], 10);
    }
    return null;
}

// Cache des pages Wikisource déjà récupérées par voie (plusieurs anciens noms peuvent partager la
// même voie/page), pour ne fetcher chaque page qu'une fois.
const wikisourceTextCache = new Map();

async function main() {
    console.log('Chargement de wiki.txt (Liste des anciens noms de voies de Paris)...');
    const wikiIndex = await loadWikiTxtIndex();
    console.log(`${wikiIndex.size} entrées avec date exploitable dans wiki.txt.`);

    const raw = await readFile(DATA_PATH, 'utf-8');
    const db = JSON.parse(raw);
    const streets = db.streets;
    const targets = streets.filter(s => Array.isArray(s.ancien_noms) && s.ancien_noms.length && !s.supprimee
        && s.ancien_noms.every(n => typeof n === 'string')); // pas déjà traité par un run précédent
    console.log(`${targets.length} voies avec ancien(s) nom(s) à traiter.`);

    let viaWiki = 0, viaLazare = 0, unresolved = 0, pageNotFound = 0;
    for (let i = 0; i < targets.length; i++) {
        const s = targets[i];
        let wikisourceTitle; // résolu paresseusement, une seule fois par voie, seulement si besoin

        const results = [];
        for (const oldName of s.ancien_noms) {
            const wikiHit = wikiIndex.get(norm(oldName));
            if (wikiHit) {
                results.push({ nom: oldName, annee: wikiHit.year, confidence: 'wikipedia' });
                viaWiki++;
                continue;
            }

            if (wikisourceTitle === undefined) {
                try { wikisourceTitle = await resolveWikisourcePage(s.name, s.cat); }
                catch (err) { console.error(`Résolution Wikisource échouée pour "${s.name}":`, err.message); wikisourceTitle = null; }
                if (!wikisourceTitle) pageNotFound++;
                await sleep(250);
            }
            if (!wikisourceTitle) { results.push({ nom: oldName, annee: null, confidence: null }); unresolved++; continue; }

            if (!wikisourceTextCache.has(wikisourceTitle)) {
                let text = null;
                try { text = await fetchWikisourceText(wikisourceTitle); }
                catch (err) { console.error(`Lecture Wikisource échouée pour "${wikisourceTitle}":`, err.message); }
                wikisourceTextCache.set(wikisourceTitle, text);
                await sleep(250);
            }
            const text = wikisourceTextCache.get(wikisourceTitle);
            const annee = text ? extractLazareDate(text, oldName) : null;
            if (annee) viaLazare++; else unresolved++;
            results.push({ nom: oldName, annee, confidence: annee ? 'scraped' : null });
        }
        s.ancien_noms = results;
        if (wikisourceTitle) s.wikisourcePage = 'https://fr.wikisource.org/wiki/' + wikisourceTitle.split('/').map(encodeURIComponent).join('/');

        if ((i + 1) % 25 === 0) console.log(`  ... ${i + 1}/${targets.length} (wiki:${viaWiki} lazare:${viaLazare} sans date:${unresolved})`);
    }

    const total = viaWiki + viaLazare + unresolved;
    console.log(`Terminé. Dates trouvées : ${viaWiki} via wiki.txt (fiable), ${viaLazare} via Wikisource/Lazare (best-effort), ${unresolved} sans date sur ${total} anciens noms. Pages Wikisource introuvables : ${pageNotFound}.`);

    db.meta.ancien_noms_note = "ancien_noms est désormais [{nom, annee, confidence}]. confidence='wikipedia' : date issue de \"Liste des anciens noms de voies de Paris\" (Wikipédia), phrasé homogène, fiable. confidence='scraped' : date extraite par motifs regex du texte libre du Dictionnaire Lazare 1844 (Wikisource), non vérifiée manuellement — indicative seulement. confidence=null (annee=null) : aucune date trouvée. script scripts/enrich-ancien-noms-dates.mjs, " + new Date().toISOString().slice(0, 10) + ".";

    await writeFile(DATA_PATH, JSON.stringify(db), 'utf-8');
    console.log('Écrit dans', DATA_PATH);
}

main().catch(err => { console.error('ÉCHEC:', err); process.exit(1); });
