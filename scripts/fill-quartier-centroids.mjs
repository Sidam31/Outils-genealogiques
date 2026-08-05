// --- REPLI "CENTRE DU QUARTIER" POUR LES VOIES SANS GÉOCODAGE PRÉCIS ---
// Script d'entretien ponctuel, à lancer APRÈS scripts/enrich-rues-paris.mjs (qui doit avoir tourné
// jusqu'au bout : ce script se base sur les voies déjà géocodées pour calculer un centroïde par
// quartier). Pas de nouvel appel réseau : centroïde = moyenne des lat/lon des voies du quartier déjà
// géocodées par Wikidata ou OSM. Marquées geoSource='quartier' (ni Wikidata, ni OSM : à ne jamais
// confondre avec une position réelle de la voie — seulement "quelque part dans ce quartier").
//
// Usage : node scripts/fill-quartier-centroids.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'assets', 'data', 'rues-paris-lazare-1844.json');

function streetQuartiers(s) {
    if (s.quartiers && s.quartiers.length) return s.quartiers.map(q => q.nom).filter(Boolean);
    return s.quartier ? [s.quartier] : [];
}

async function main() {
    const raw = await readFile(DATA_PATH, 'utf-8');
    const db = JSON.parse(raw);
    const streets = db.streets;
    const live = streets.filter(s => !s.supprimee);

    const geocoded = live.filter(s => s.lat != null && s.lon != null);
    const ungeocoded = live.filter(s => s.lat == null || s.lon == null);
    console.log(`${geocoded.length} voies déjà géocodées, ${ungeocoded.length} sans coordonnées.`);

    // Centroïde (moyenne simple lat/lon) par quartier, à partir des voies déjà géocodées.
    const sums = new Map(); // nom -> { latSum, lonSum, n }
    for (const s of geocoded) {
        for (const nom of streetQuartiers(s)) {
            const acc = sums.get(nom) || { latSum: 0, lonSum: 0, n: 0 };
            acc.latSum += s.lat; acc.lonSum += s.lon; acc.n++;
            sums.set(nom, acc);
        }
    }
    const centroids = new Map();
    for (const [nom, acc] of sums) centroids.set(nom, { lat: acc.latSum / acc.n, lon: acc.lonSum / acc.n, n: acc.n });
    console.log(`Centroïdes calculés pour ${centroids.size} quartiers (à partir d'au moins 1 voie géocodée chacun).`);

    let filled = 0, noQuartier = 0, noCentroid = 0;
    for (const s of ungeocoded) {
        const noms = streetQuartiers(s);
        if (!noms.length) { noQuartier++; continue; }
        // Une voie peut traverser plusieurs quartiers : on prend le centroïde du premier qui a des
        // données (ordre déjà porté par le GEDCOM/Lazare, pas de préférence particulière ici).
        const withCentroid = noms.find(nom => centroids.has(nom));
        if (!withCentroid) { noCentroid++; continue; }
        const c = centroids.get(withCentroid);
        s.lat = c.lat; s.lon = c.lon; s.geoSource = 'quartier'; s.geoQuartier = withCentroid;
        filled++;
    }
    console.log(`${filled} voies positionnées au centre de leur quartier. ${noQuartier} sans quartier connu, ${noCentroid} dont le(s) quartier(s) n'a/ont aucune voie géocodée pour servir de référence.`);

    db.meta.geocoding_note = (db.meta.geocoding_note || '') +
        ` Voies sans géocodage précis : positionnées au centre (moyenne) de leur quartier si possible (geoSource='quartier', sans lien Wikipédia, précision très approximative) ; script scripts/fill-quartier-centroids.mjs, ${new Date().toISOString().slice(0, 10)}.`;

    await writeFile(DATA_PATH, JSON.stringify(db), 'utf-8');
    console.log('Écrit dans', DATA_PATH);
}

main().catch(err => { console.error('ÉCHEC:', err); process.exit(1); });
