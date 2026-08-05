// --- ENRICHISSEMENT DE LA BASE "RUES DE PARIS" (GPS + lien Wikipédia) ---
// Script d'entretien ponctuel (pas exécuté par la page elle-même) : ajoute à chaque voie "vivante"
// (non supprimée) de assets/data/rues-paris-lazare-1844.json des coordonnées GPS et, si trouvé, un
// lien vers l'article Wikipédia correspondant, pour alimenter la vue carte de rues-paris.html.
//
// Deux sources, dans cet ordre de préférence :
//  1. Wikidata (SPARQL) : rapide (une seule requête), donne aussi le lien Wikipédia quand la voie a
//     son propre article. Couvre les voies notables (~49% du corpus lors du prototype).
//  2. OpenStreetMap Nominatim (une requête par voie non trouvée sur Wikidata, throttlée à ~1/s selon
//     leur politique d'usage) : géocode les voies qui existent encore aujourd'hui sous un nom proche,
//     sans lien Wikipédia.
// Les voies qui n'existent plus du tout (renommées sans display trace, ou dont le nom a trop changé)
// restent sans coordonnées : ni Wikidata ni un géocodeur du présent ne peuvent les situer.
//
// Usage : node scripts/enrich-rues-paris.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'assets', 'data', 'rues-paris-lazare-1844.json');
const USER_AGENT = 'VisuGedcom-rues-paris-enrichment/1.0 (one-off maintenance script; https://github.com/Sidam31/Outils-genealogiques)';

function norm(s) {
    return s
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '') // retire les accents
        .replace(/[’']/g, "'")
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

async function fetchWikidataStreets() {
    const query = `
        SELECT ?item ?itemLabel ?coord ?article WHERE {
          VALUES ?type { wd:Q79007 wd:Q7543083 wd:Q54114 wd:Q174782 wd:Q12731 wd:Q1320830 }
          ?item wdt:P31 ?type.
          ?item wdt:P131/wdt:P131* wd:Q90.
          OPTIONAL { ?item wdt:P625 ?coord. }
          OPTIONAL {
            ?article schema:about ?item ;
                     schema:isPartOf <https://fr.wikipedia.org/> .
          }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "fr". }
        }
    `;
    const url = 'https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' });
    // Le service de requêtes Wikidata renvoie de temps en temps un 502/503 transitoire sous charge :
    // quelques tentatives avec un délai suffisent, plutôt que de faire échouer tout le script pour ça.
    let data;
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' } });
            if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
            data = await res.json();
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
            console.warn(`Wikidata: tentative ${attempt}/4 échouée (${err.message}), nouvel essai dans 10s...`);
            await sleep(10000);
        }
    }
    if (lastErr) throw lastErr;

    const byItem = new Map();
    for (const row of data.results.bindings) {
        const qid = row.item.value;
        if (!byItem.has(qid)) byItem.set(qid, { label: row.itemLabel.value, coord: null, article: null });
        const entry = byItem.get(qid);
        if (row.coord && !entry.coord) entry.coord = row.coord.value;
        if (row.article && !entry.article) entry.article = row.article.value;
    }

    const byName = new Map(); // normalized name -> {lat, lon, wikipedia}
    for (const { label, coord, article } of byItem.values()) {
        if (!coord) continue;
        const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(coord);
        if (!m) continue;
        const key = norm(label);
        if (!byName.has(key)) byName.set(key, { lat: parseFloat(m[2]), lon: parseFloat(m[1]), wikipedia: article || null });
    }
    return byName;
}

// Boîte englobante large de Paris intra-muros, pour empêcher Nominatim de renvoyer une rue
// homonyme d'une autre ville. lon min,lat max,lon max,lat min (format viewbox de Nominatim).
const PARIS_VIEWBOX = '2.224,48.902,2.469,48.815';

async function geocodeNominatim(name) {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q: `${name}, Paris, France`,
        format: 'json',
        limit: '1',
        countrycodes: 'fr',
        viewbox: PARIS_VIEWBOX,
        bounded: '1'
    });
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const results = await res.json();
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const raw = await readFile(DATA_PATH, 'utf-8');
    const db = JSON.parse(raw);
    const streets = db.streets;
    const live = streets.filter(s => !s.supprimee);
    console.log(`${streets.length} voies au total, ${live.length} "vivantes" à géocoder.`);

    console.log('Interrogation de Wikidata...');
    const wdByName = await fetchWikidataStreets();
    console.log(`${wdByName.size} voies parisiennes trouvées sur Wikidata (avec coordonnées).`);

    let viaWikidataName = 0, viaWikidataVariant = 0, viaWikidataDevenu = 0, viaOsm = 0, unmatched = 0;
    const toGeocode = [];

    for (const s of live) {
        let hit = wdByName.get(norm(s.name));
        if (hit) { viaWikidataName++; }
        else {
            for (const v of s.variants || []) {
                hit = wdByName.get(norm(v));
                if (hit) { viaWikidataVariant++; break; }
            }
        }
        if (!hit) {
            for (const d of s.devenu || []) {
                if (!d.nom_actuel) continue;
                hit = wdByName.get(norm(d.nom_actuel));
                if (hit) { viaWikidataDevenu++; break; }
            }
        }
        if (hit) {
            s.lat = hit.lat; s.lon = hit.lon;
            if (hit.wikipedia) s.wikipedia = hit.wikipedia;
            s.geoSource = 'wikidata';
        } else {
            toGeocode.push(s);
        }
    }

    console.log(`Wikidata : ${viaWikidataName} (nom exact) + ${viaWikidataVariant} (variante) + ${viaWikidataDevenu} (nom actuel) = ${viaWikidataName + viaWikidataVariant + viaWikidataDevenu} voies.`);

    // ENRICH_LIMIT=N : limite le géocodage OSM aux N premières voies restantes (utile pour un essai
    // rapide avant de lancer le géocodage complet, qui prend ~20-25 min à 1 req/s).
    const limit = process.env.ENRICH_LIMIT ? parseInt(process.env.ENRICH_LIMIT, 10) : toGeocode.length;
    const batch = toGeocode.slice(0, limit);
    console.log(`${toGeocode.length} voies restantes à géocoder via OpenStreetMap Nominatim (~1/s) ; traitement de ${batch.length}...`);

    for (let i = 0; i < batch.length; i++) {
        const s = batch[i];
        try {
            const geo = await geocodeNominatim(s.name);
            if (geo) {
                s.lat = geo.lat; s.lon = geo.lon; s.geoSource = 'osm';
                viaOsm++;
            } else {
                unmatched++;
            }
        } catch (err) {
            console.error(`Échec géocodage "${s.name}":`, err.message);
            unmatched++;
        }
        if ((i + 1) % 50 === 0) console.log(`  ... ${i + 1}/${batch.length} (${viaOsm} trouvées, ${unmatched} sans résultat)`);
        await sleep(1100); // politique d'usage Nominatim : max 1 requête/seconde
    }

    console.log(`OpenStreetMap : ${viaOsm} voies géocodées, ${unmatched} sans résultat (probablement disparues sous ce nom).`);
    console.log(`Total géocodé : ${viaWikidataName + viaWikidataVariant + viaWikidataDevenu + viaOsm} / ${live.length} (${((viaWikidataName + viaWikidataVariant + viaWikidataDevenu + viaOsm) / live.length * 100).toFixed(1)}%)`);

    db.meta.geocoding_note = "lat/lon ajoutés depuis Wikidata (geoSource='wikidata', avec lien Wikipédia si disponible) ou OpenStreetMap Nominatim (geoSource='osm', sans lien Wikipédia) ; script scripts/enrich-rues-paris.mjs, " + new Date().toISOString().slice(0, 10) + ".";

    await writeFile(DATA_PATH, JSON.stringify(db), 'utf-8');
    console.log('Écrit dans', DATA_PATH);
}

main().catch(err => { console.error('ÉCHEC:', err); process.exit(1); });
