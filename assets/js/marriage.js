// --- MARIAGE : lien direct vers les tables des contrats de mariage (fonds Enregistrement) ---
// Même principe que successions.js (lien vers le bon registre, pas vers le bon acte précis), mais
// indexé sur le mariage (p.marrYear/p.marrGeo, comme le mode Notariat) plutôt que le décès : seul
// le mariage donne lieu à un contrat de mariage.
//
// Couverture pilote (2 départements, voir scripts_py/scrape_contrats_mariage_arkotheque.py) : les
// deux sont sur le même portail "Arkothèque" que Paris/Allier (successions.js), dépouillés au sein
// du même fonds "9Q Enregistrement"/"Contrôle des actes" que la série successions déjà couverte,
// simplement filtrés sur l'intitulé "contrats de mariage" plutôt que "successions et absences".
//
// Pour couvrir un nouveau département : écrire son propre scraper (même famille que
// scripts_py/scrape_successions_*.py), générer son JSON sous assets/data/, puis ajouter une entrée
// ci-dessous. Si un futur département publie une mécanique de correspondance différente (bureau
// géographique sans commune exacte, subdivision par patronyme...), suivre l'exemple du système
// 'kind' de successions.js plutôt que de le réinventer ici.
import { deptCode, normalizePlace } from './geo.js';

export const MARRIAGE_DEPTS = {
    '78': {
        label: 'Yvelines',
        // Bornes réelles de la série (42 registres scrapés, voir
        // scrape_contrats_mariage_arkotheque.py).
        minYear: 1760,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_78.json',
        catalogUrl: 'https://archives.yvelines.fr/rechercher/archives-en-ligne/enregistrementbrtables-referencant-les-actesbret-declarations-de-successions/tables-de-lenregistrement',
    },
    '43': {
        label: 'Haute-Loire',
        // Bornes réelles de la série (157 registres scrapés, voir
        // scrape_contrats_mariage_arkotheque.py).
        minYear: 1737,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_43.json',
        catalogUrl: 'https://www.archives43.fr/archives-en-ligne/familles-et-individus-en-haute-loire/tables-du-controle-des-actes-et-de-lenregistrement',
    },
    '31': {
        label: 'Haute-Garonne',
        // Bornes réelles de la série (21 registres scrapés sur 30 bureaux — les 9 restants n'ont
        // pas de "Table des contrats de mariage" cataloguée dans ce fonds, voir
        // scrape_contrats_mariage_haute_garonne.py). Portail Ligeo Archives derrière Anubis, même
        // autorisation explicite que la série successions de ce département.
        minYear: 1763,
        maxYear: 1866,
        registersUrl: './assets/data/contrats_mariage_31.json',
        catalogUrl: 'https://archives.haute-garonne.fr/n/enregistrement/n:352',
    },
};

function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
}

// Candidates à essayer pour une correspondance de commune, du lieu le plus précis (lieu-dit/hameau
// tel qu'acté) jusqu'au lieu parent le plus général connu — voir geo.cityChain dans gedcom.js et le
// même principe dans successions.js/cityCandidates.
function cityCandidates(geo) {
    return (geo.cityChain && geo.cityChain.length) ? geo.cityChain : [geo.city];
}
function parentContextLabel(geo, matched) {
    return matched !== geo.city ? `"${geo.city}" non reconnu — résolu via le lieu parent "${matched}"` : null;
}

// Comme pickRegisters dans successions.js : renvoie les registres couvrant l'année recherchée, ou à
// défaut le plus proche dans le temps (bornes de registre imprécises plutôt qu'aucune piste).
function pickRegisters(records, year) {
    if (!records || !records.length) return [];
    const containing = records.filter(r => year >= r.yearStart && year <= r.yearEnd);
    if (containing.length) return containing;
    let best = records[0], bestDist = Infinity;
    records.forEach(r => {
        const dist = year < r.yearStart ? r.yearStart - year : year - r.yearEnd;
        if (dist < bestDist) { bestDist = dist; best = r; }
    });
    return [best];
}

function loadDeptIndex(deptCodeKey) {
    const config = MARRIAGE_DEPTS[deptCodeKey];
    return fetchJson(config.registersUrl)
        .then(records => {
            const registerIndex = new Map();
            records.forEach(r => {
                const key = normalizePlace(r.place);
                if (!registerIndex.has(key)) registerIndex.set(key, []);
                registerIndex.get(key).push(r);
            });
            return { config, registerIndex };
        })
        .catch(err => {
            console.error(`Chargement des contrats de mariage (dept ${deptCodeKey}) échoué:`, err);
            return { config, registerIndex: new Map() };
        });
}

const indexPromises = new Map();

// Démarre le chargement de tous les départements couverts dès l'import du module (même principe
// que loadSuccessionIndexes/loadNotairesIndex) : un échec partiel n'empêche pas les autres
// départements de fonctionner.
export function loadMarriageIndexes() {
    return Promise.all(
        Object.keys(MARRIAGE_DEPTS).map(dc => {
            if (!indexPromises.has(dc)) indexPromises.set(dc, loadDeptIndex(dc));
            return indexPromises.get(dc).then(idx => [dc, idx]);
        })
    ).then(entries => new Map(entries));
}

function resolveRegisters(idx, geo, year) {
    for (const candidate of cityCandidates(geo)) {
        const exact = idx.registerIndex.get(normalizePlace(candidate));
        if (exact && exact.length) {
            return { matchType: 'exact', registers: pickRegisters(exact, year), contextLabel: parentContextLabel(geo, candidate) };
        }
    }
    return { matchType: 'none', registers: [], contextLabel: null };
}

// indexes: Map département -> {config, registerIndex} (voir loadMarriageIndexes)
// opts: { ancestorScopeSet }
export function computeMarriageLeads(list, indexes, opts) {
    opts = opts || {};
    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;
        const year = p.marrYear;
        const geo = p.marrGeo;
        if (year == null || !geo || !geo.city || !geo.dept) return;

        const dc = deptCode(geo.dept);
        const idx = indexes.get(dc);
        if (!idx) return; // département non couvert par ce module
        const { config } = idx;
        if (year < config.minYear || year > config.maxYear) return; // hors des bornes de la série

        const resolved = resolveRegisters(idx, geo, year);
        results.push({
            person: p, year, city: geo.city, dept: dc, deptLabel: config.label,
            ...resolved,
            fallbackUrl: resolved.registers.length ? null : config.catalogUrl,
        });
    });
    return results;
}
