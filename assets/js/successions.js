// --- SUCCESSIONS : lien direct vers les tables des successions et absences (série 3Q) ---
// Pour chaque ancêtre décédé à une date et une commune connues dans un département couvert
// ci-dessous, un lien vers le(s) registre(s) du portail des Archives départementales concerné,
// dans la série des tables des successions et absences. Contrairement à la base Notaires (voir
// notaires.js), ces portails n'ont PAS d'index nominatif sur cette série : le lien pointe vers un
// registre (un volume de plusieurs années, à feuilleter soi-même), pas vers un acte précis — même
// principe que le mode Recensement (lien vers le bon registre, pas vers la bonne ligne).
//
// Chaque département a son propre portail (logiciel, URL, formUuid différents), donc son propre
// jeu de données précalculé par scripts_py/scrape_successions_<dept>.py (+, si le département a
// des "bureaux d'enregistrement" d'ancien régime plutôt qu'un registre par commune, par
// scripts_py/build_successions_<dept>_bureaux.py — voir ce script pour la méthode et ses limites).
// Pour couvrir un nouveau département : écrire son propre scraper (le HTML variera d'un portail à
// l'autre), générer ses JSON sous assets/data/, puis ajouter une entrée à SUCCESSION_DEPTS
// ci-dessous — le reste de ce module (chargement, correspondance commune/année, repli) est déjà
// générique.
import { deptCode, normalizePlace } from './geo.js';

export const SUCCESSION_DEPTS = {
    '59': {
        label: 'Nord',
        // Bornes réelles de la série : pas de registre en dehors de cette période (vérifié en
        // parcourant l'intégralité des 1932 registres scrapés, voir scrape_successions_nord.py).
        minYear: 1791,
        maxYear: 1970,
        portalBase: 'https://archivesdepartementales.lenord.fr/search/results',
        formUuid: '6eaeac65-9e1b-43ea-bc9f-902abd458466',
        registersUrl: './assets/data/successions_59.json',
        bureauxUrl: './assets/data/successions_59_bureaux.json',
    },
};

// "LILLE (1er bureau)" -> "LILLE" : le nom de la ville-siège du bureau, sans le qualificatif
// d'arrondissement/canton — plusieurs libellés du vocabulaire contrôlé partagent souvent la même
// ville-siège (LILLE / LILLE (1er/2e/3e bureau), ROUBAIX / (Ville) / (Canton)...), et un acte
// mentionnant juste "Lille" peut avoir été enregistré dans n'importe lequel des bureaux de Lille
// selon le quartier — impossible à deviner depuis le seul GEDCOM. On regroupe donc tous les
// registres d'une même ville-siège pour proposer TOUTES les pistes plutôt qu'une seule au hasard.
function baseBureauName(place) {
    return place.replace(/\s*\(.*\)\s*$/, '').trim();
}

// Lien de repli quand aucun registre précis n'a pu être identifié (commune absente du
// dépouillement, y compris via le bureau le plus proche) : liste, pour l'année demandée, tous les
// registres du département sans filtrer par lieu — à feuilleter soi-même plutôt que rien.
function buildYearOnlySearchUrl(config, year) {
    const params = new URLSearchParams();
    params.set('formUuid', config.formUuid);
    params.set('sort', 'referencecode_asc');
    params.set('mode', 'list');
    params.set('facet_media', 'image');
    if (year != null) {
        params.set('1-date_begin', year);
        params.set('1-date_end', year);
    }
    params.set('2-date', '');
    return `${config.portalBase}?${params.toString()}`;
}

const indexPromises = new Map();

// Charge et indexe, pour un département donné : la liste des registres scrapés (groupés par
// ville-siège de bureau) et la table de repli commune -> bureau le plus proche (voir
// build_successions_59_bureaux.py). Un échec réseau n'est pas fatal : le département retombe
// simplement sur "aucune piste" plutôt que de bloquer toute l'analyse.
function loadDeptIndex(deptCodeKey) {
    const config = SUCCESSION_DEPTS[deptCodeKey];
    const fetchJson = url => fetch(url, { cache: 'no-store' }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
    return Promise.all([
        fetchJson(config.registersUrl),
        config.bureauxUrl ? fetchJson(config.bureauxUrl).catch(() => ({})) : Promise.resolve({}),
    ]).then(([registers, bureaux]) => {
        const registerIndex = new Map();
        registers.forEach(r => {
            const key = normalizePlace(baseBureauName(r.place));
            if (!registerIndex.has(key)) registerIndex.set(key, []);
            registerIndex.get(key).push(r);
        });
        const bureauIndex = new Map();
        Object.entries(bureaux).forEach(([communeNorm, entry]) => {
            bureauIndex.set(normalizePlace(communeNorm), entry);
        });
        return { config, registerIndex, bureauIndex };
    }).catch(err => {
        console.error(`Chargement des successions (dept ${deptCodeKey}) échoué:`, err);
        return { config, registerIndex: new Map(), bureauIndex: new Map() };
    });
}

// Démarre le chargement de tous les départements couverts dès l'import du module (voir
// loadNotairesIndex dans notaires.js pour le même principe) : un échec partiel n'empêche pas les
// autres départements de fonctionner.
export function loadSuccessionIndexes() {
    return Promise.all(
        Object.keys(SUCCESSION_DEPTS).map(dc => {
            if (!indexPromises.has(dc)) indexPromises.set(dc, loadDeptIndex(dc));
            return indexPromises.get(dc).then(idx => [dc, idx]);
        })
    ).then(entries => new Map(entries));
}

// Parmi les registres candidats (déjà filtrés sur la bonne ville-siège), renvoie ceux dont la
// période couvre l'année recherchée (il peut y en avoir plusieurs : bureaux multiples d'une même
// ville, périodes redondantes/qui se chevauchent...) ; à défaut, le registre le plus proche dans
// le temps, pour ne jamais renvoyer une piste vide quand des registres existent bel et bien pour
// cette commune, juste pas pile sur cette année (bornes de registre imprécises, calendrier
// républicain converti approximativement — voir scrape_successions_nord.py).
function pickRegisters(records, year) {
    const containing = records.filter(r => year >= r.yearStart && year <= r.yearEnd);
    if (containing.length) return containing;
    if (!records.length) return [];
    let best = records[0], bestDist = Infinity;
    records.forEach(r => {
        const dist = year < r.yearStart ? r.yearStart - year : year - r.yearEnd;
        if (dist < bestDist) { bestDist = dist; best = r; }
    });
    return [best];
}

// Seul le décès donne lieu à une déclaration de succession (contrairement au notariat, un mariage
// n'en produit pas) : uniquement l'événement DEAT est considéré ici.
// indexes: Map département -> {config, registerIndex, bureauIndex} (voir loadSuccessionIndexes)
// opts: { ancestorScopeSet }
export function computeSuccessionLeads(list, indexes, opts) {
    opts = opts || {};
    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;
        const year = p.death?.year;
        const geo = p.death?.geo;
        if (year == null || !geo || !geo.city || !geo.dept) return;

        const dc = deptCode(geo.dept);
        const idx = indexes.get(dc);
        if (!idx) return; // département non couvert par ce module
        const { config, registerIndex, bureauIndex } = idx;
        if (year < config.minYear || year > config.maxYear) return; // hors des bornes de la série

        const cityNorm = normalizePlace(geo.city);
        let matchType, registers, bureauInfo = null;
        const exact = registerIndex.get(cityNorm);
        if (exact && exact.length) {
            matchType = 'exact';
            registers = pickRegisters(exact, year);
        } else {
            bureauInfo = bureauIndex.get(cityNorm) || null;
            const viaBureau = bureauInfo ? registerIndex.get(normalizePlace(bureauInfo.bureau)) : null;
            if (viaBureau && viaBureau.length) {
                matchType = 'bureau';
                registers = pickRegisters(viaBureau, year);
            } else {
                matchType = 'none';
                registers = [];
            }
        }

        results.push({
            person: p, year, city: geo.city, dept: dc, deptLabel: config.label,
            matchType, bureauInfo, registers,
            fallbackUrl: registers.length ? null : buildYearOnlySearchUrl(config, year),
        });
    });
    return results;
}
