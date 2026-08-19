// --- MARIAGE : lien direct vers les tables des contrats de mariage (fonds Enregistrement) ---
// Même principe que successions.js (lien vers le bon registre, pas vers le bon acte précis), mais
// indexé sur la FAMILLE (f.marr, un contrat de mariage concerne le couple, pas un individu isolé) :
// une ligne par couple, pas une ligne par personne comme les autres modes - contrairement à
// p.marrYear (la plus ANCIENNE date de mariage d'un individu, utilisée par notaires.js), ceci
// couvre CHAQUE mariage d'une personne qui s'est remariée, pas seulement le premier.
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
    '72': {
        label: 'Sarthe',
        // Bornes réelles de la série (113 registres scrapés, 30 lieux distincts, voir
        // scrape_contrats_mariage_arkotheque.py). Même portail Arkothèque que 78/43, déjà mixé
        // avec les successions sur cette même page (pas de découverte séparée nécessaire).
        minYear: 1776,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_72.json',
        catalogUrl: 'https://archives.sarthe.fr/archives-en-ligne/tables-de-lenregistrement-sous-serie-3-q',
    },
    '82': {
        label: 'Tarn-et-Garonne',
        // Bornes réelles de la série (106 registres scrapés, 20 bureaux, voir
        // scrape_contrats_mariage_tarn_et_garonne.py). Même document Anaphore/Bach unique que les
        // successions de ce département (FRAD082_IR_00383), qui mélange déjà tous les types
        // d'actes du fonds "Enregistrement" - la table des contrats de mariage y est un noeud
        // frère de "Table des successions et absences", filtré côté client comme elle.
        minYear: 1755,
        maxYear: 1866,
        registersUrl: './assets/data/contrats_mariage_82.json',
        catalogUrl: 'https://recherche.archives82.fr/document/FRAD082_IR_00383',
    },
    '30': {
        label: 'Gard',
        // Bornes réelles de la série (136 registres scrapés, 29 lieux, voir
        // scrape_contrats_mariage_anaphore.py). Portail Anaphore/Bach, fonds "Enregistrement" par
        // bureau : "Contrats de mariage" est un dossier frère de "Table alphabétique des
        // successions et absences" dans chaque document de bureau.
        minYear: 1750,
        maxYear: 1869,
        registersUrl: './assets/data/contrats_mariage_30.json',
        catalogUrl: 'https://earchives.gard.fr/document/FRAD030_ENREGISTREMENT',
    },
    '22': {
        label: "Côtes-d'Armor",
        // Bornes réelles de la série (41 registres scrapés, 28 lieux, voir
        // scrape_contrats_mariage_anaphore.py). Même logiciel/mécanique que le Gard.
        minYear: 1765,
        maxYear: 1873,
        registersUrl: './assets/data/contrats_mariage_22.json',
        catalogUrl: 'https://recherche.archives.cotesdarmor.fr/archives/classification-scheme',
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
// yearGap (0 quand l'année est bien couverte) accompagne ce repli pour signaler une approximation
// potentiellement lointaine à l'affichage.
function pickRegisters(records, year) {
    if (!records || !records.length) return { registers: [], yearGap: 0 };
    const containing = records.filter(r => year >= r.yearStart && year <= r.yearEnd);
    if (containing.length) return { registers: containing, yearGap: 0 };
    let best = records[0], bestDist = Infinity;
    records.forEach(r => {
        const dist = year < r.yearStart ? r.yearStart - year : year - r.yearEnd;
        if (dist < bestDist) { bestDist = dist; best = r; }
    });
    return { registers: [best], yearGap: bestDist };
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
            const picked = pickRegisters(exact, year);
            return { matchType: 'exact', registers: picked.registers, yearGap: picked.yearGap, contextLabel: parentContextLabel(geo, candidate) };
        }
    }
    return { matchType: 'none', registers: [], yearGap: 0, contextLabel: null };
}

// fams: Map (voir GedcomParser.fams) — chaque famille porte son propre événement de mariage
// (f.marr : year/geo/day/month/approx), déjà normalisé par finalizeAllGeo() comme n'importe quel
// autre lieu du GEDCOM (geo.city/geo.dept/geo.cityChain).
// map: Map id -> individu, pour résoudre f.husb/f.wife en objets personne complets.
// indexes: Map département -> {config, registerIndex} (voir loadMarriageIndexes)
// opts: { ancestorScopeSet } — une famille est retenue si AU MOINS un des deux conjoints est dans
// le périmètre (l'autre peut être un conjoint "entré" par mariage, hors de la lignée de sang).
export function computeMarriageLeads(fams, map, indexes, opts) {
    opts = opts || {};
    const results = [];
    fams.forEach(f => {
        if (opts.ancestorScopeSet) {
            const husbIn = f.husb && opts.ancestorScopeSet.has(f.husb);
            const wifeIn = f.wife && opts.ancestorScopeSet.has(f.wife);
            if (!husbIn && !wifeIn) return;
        }
        const year = f.marr?.year;
        const geo = f.marr?.geo;
        if (year == null || !geo || !geo.city || !geo.dept) return;

        const husb = f.husb ? map.get(f.husb) : null;
        const wife = f.wife ? map.get(f.wife) : null;
        if (!husb && !wife) return; // ni époux ni épouse identifiable (ne devrait pas arriver)

        const dc = deptCode(geo.dept);
        const idx = indexes.get(dc);
        if (!idx) return; // département non couvert par ce module
        const { config } = idx;
        if (year < config.minYear || year > config.maxYear) return; // hors des bornes de la série

        const resolved = resolveRegisters(idx, geo, year);
        results.push({
            fam: f, husb, wife, marrEvent: f.marr, year, city: geo.city, dept: dc, deptLabel: config.label,
            ...resolved,
            fallbackUrl: resolved.registers.length ? null : config.catalogUrl,
        });
    });
    return results;
}
