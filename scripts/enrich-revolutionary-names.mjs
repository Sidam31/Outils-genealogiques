// --- NOMS RÉVOLUTIONNAIRES (1793-1799) ET NOMS INITIAUX (AVANT-RÉVOLUTION) ---
// Script d'entretien ponctuel, entièrement local (aucun appel réseau) : enrichit ancien_noms depuis
// "Voies revolutionnaires.txt" (Paul Lacombe, Les Noms des rues de Paris sous la Révolution), un
// tableau à 3 colonnes {nom initial, nom révolutionnaire, nom actuel/dernier nom}. Complète des
// noms parfois absents de Lazare 1844 (des rues renommées puis reverties avant 1844, sans laisser
// de trace dans son dictionnaire) et date les entrées déjà connues mais non datées.
//
// Contrairement à enrich-ancien-noms-dates.mjs (année précise), Lacombe ne donne qu'une période
// ("Révolution") sans année exacte par rue : les entrées ajoutées portent periode='Révolution'
// (confidence='lacombe') plutôt qu'une fausse précision numérique.
//
// À lancer après les autres scripts enrich-*.mjs (pas de dépendance, mais évite d'écrire le même
// fichier depuis deux processus en même temps).
//
// Usage : node scripts/enrich-revolutionary-names.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'assets', 'data', 'rues-paris-lazare-1844.json');
const SOURCE_PATH = path.join(__dirname, '..', 'Voies revolutionnaires.txt');

function norm(s) {
    return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[’]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
}

// "Rue du Contrat-Social (disparue)" -> "Rue du Contrat-Social" : les annotations entre parenthèses
// de la colonne "nom actuel" ne font pas partie du nom à faire correspondre à notre base.
function stripAnnotation(name) {
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

async function main() {
    const raw = await readFile(SOURCE_PATH, 'utf-8');
    const rows = raw.split(/\r?\n/)
        .filter(l => l.trim() && !l.startsWith('source:') && !l.startsWith('Nom initial'))
        .map(l => l.split('\t').map(c => c.trim()))
        .filter(cols => cols.length === 3 && cols[1] && cols[2]); // ignore les lignes à 2 colonnes / fragments

    console.log(`${rows.length} lignes exploitables dans "Voies revolutionnaires.txt".`);

    const db = JSON.parse(await readFile(DATA_PATH, 'utf-8'));
    const byName = new Map();
    for (const s of db.streets) {
        const key = norm(s.name);
        if (!byName.has(key)) byName.set(key, s);
    }

    let matched = 0, unmatched = 0, addedRevolutionnaire = 0, addedInitial = 0, datedExisting = 0;
    const unmatchedSamples = [];

    for (const [initial, revolutionnaire, actuelRaw] of rows) {
        const actuel = stripAnnotation(actuelRaw);
        const s = byName.get(norm(actuel));
        if (!s) { unmatched++; if (unmatchedSamples.length < 15) unmatchedSamples.push(actuelRaw); continue; }
        matched++;

        if (!Array.isArray(s.ancien_noms)) s.ancien_noms = [];
        // Les entrées string[] restantes (voies supprimées, jamais passées par enrich-ancien-noms-dates.mjs)
        // sont converties au même format {nom, annee, confidence} pour rester homogènes.
        s.ancien_noms = s.ancien_noms.map(a => typeof a === 'string' ? { nom: a, annee: null, confidence: null } : a);

        for (const [nom, isRevolutionnaire] of [[revolutionnaire, true], [initial, false]]) {
            if (norm(nom) === norm(s.name)) continue; // le "nom initial" est parfois déjà le nom actuel
            const existing = s.ancien_noms.find(a => norm(a.nom) === norm(nom));
            if (existing) {
                if (!existing.annee && !existing.periode) {
                    existing.periode = isRevolutionnaire ? 'Révolution' : 'avant-Révolution';
                    existing.confidence = 'lacombe';
                    datedExisting++;
                }
            } else {
                s.ancien_noms.push({ nom, annee: null, periode: isRevolutionnaire ? 'Révolution' : 'avant-Révolution', confidence: 'lacombe' });
                if (isRevolutionnaire) addedRevolutionnaire++; else addedInitial++;
            }
        }
    }

    console.log(`Voies actuelles reconnues : ${matched}/${rows.length} (${unmatched} non trouvées, ex. voies disparues sans trace dans Lazare 1844).`);
    console.log(`Anciens noms ajoutés : ${addedRevolutionnaire} révolutionnaires + ${addedInitial} pré-révolutionnaires. Entrées déjà connues datées "période" : ${datedExisting}.`);
    if (unmatchedSamples.length) console.log('Exemples non trouvés :', unmatchedSamples);

    db.meta.revolutionary_names_note = "Noms révolutionnaires (1793-1799) et pré-révolutionnaires ajoutés/datés depuis \"Voies revolutionnaires.txt\" (Paul Lacombe, Les Noms des rues de Paris sous la Révolution) : ancien_noms[].periode='Révolution'|'avant-Révolution', confidence='lacombe'. Pas d'année précise (Lacombe ne la donne pas rue par rue). script scripts/enrich-revolutionary-names.mjs, " + new Date().toISOString().slice(0, 10) + ".";

    await writeFile(DATA_PATH, JSON.stringify(db), 'utf-8');
    console.log('Écrit dans', DATA_PATH);
}

main().catch(err => { console.error('ÉCHEC:', err); process.exit(1); });
