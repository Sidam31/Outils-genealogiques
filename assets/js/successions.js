// --- SUCCESSIONS : lien direct vers les tables des successions et absences (série 3Q) ---
// Pour chaque ancêtre décédé à une date et une commune connues dans un département couvert
// ci-dessous, un lien vers le(s) registre(s) du portail des Archives départementales concerné,
// dans la série des tables des successions et absences. Ces portails n'ont PAS d'index nominatif
// sur cette série : le lien pointe vers un registre (un volume de plusieurs années, à feuilleter
// soi-même), pas vers un acte précis — même principe que le mode Recensement (lien vers le bon
// registre, pas vers la bonne ligne).
//
// Chaque département a son propre portail (logiciel, structure, URL différents), donc son propre
// jeu de données précalculé par scripts_py/scrape_successions_<dept>.py. Deux mécaniques de
// correspondance commune -> registre coexistent, selon ce que le département publie
// (config.kind) :
// - 'facet' (Nord 59, Tarn-et-Garonne 82, Seine-Maritime 76) : le portail liste les registres par
//   ville-siège de "bureau d'enregistrement" (ancien régime), sans table officielle commune ->
//   bureau ; l'app calcule un repli par proximité géographique
//   (scripts_py/build_successions_*_bureaux.py), approximatif et présenté comme tel. Le nom
//   "facet" vient du Nord (recherche à facettes) même si Tarn-et-Garonne et Seine-Maritime sont en
//   réalité des arbres de classement (deux logiciels différents en plus) : ce qui définit le kind,
//   c'est la mécanique de correspondance (bureau seul, sans initiale de patronyme), pas la forme
//   du portail — voir fallbackUrl plus bas, qui lui dépend du portail (config.formUuid).
// - 'bureau-letter' (Tarn, 81) : le département publie lui-même la vraie table historique commune
//   -> bureau (avec ses dates de changement, scripts_py/build_successions_tarn_communes.py) ET ses
//   registres sont eux-mêmes classés par bureau PUIS par initiale de patronyme (répertoires
//   alphabétiques) : la correspondance est donc exacte, pas une approximation, et plus précise
//   qu'à Nord puisqu'elle peut aussi cibler la bonne tranche de patronymes.
//
// Pour couvrir un nouveau département : écrire son propre scraper (le HTML/la structure varient
// d'un portail à l'autre), générer ses JSON sous assets/data/, puis ajouter une entrée à
// SUCCESSION_DEPTS avec le 'kind' qui correspond le mieux à ce que ce portail publie — en
// ajoutant un nouveau kind si aucun des deux existants ne convient.
import { deptCode, normalizePlace } from './geo.js';

export const SUCCESSION_DEPTS = {
    '59': {
        label: 'Nord',
        kind: 'facet',
        // Bornes réelles de la série : pas de registre en dehors de cette période (vérifié en
        // parcourant l'intégralité des 1932 registres scrapés, voir scrape_successions_nord.py).
        minYear: 1791,
        maxYear: 1970,
        portalBase: 'https://archivesdepartementales.lenord.fr/search/results',
        formUuid: '6eaeac65-9e1b-43ea-bc9f-902abd458466',
        registersUrl: './assets/data/successions_59.json',
        bureauxUrl: './assets/data/successions_59_bureaux.json',
    },
    '81': {
        label: 'Tarn',
        kind: 'bureau-letter',
        // Bornes réelles de la série (8523 registres scrapés, voir scrape_successions_tarn.py).
        minYear: 1790,
        maxYear: 1973,
        registersUrl: './assets/data/successions_81.json',
        communesUrl: './assets/data/successions_81_communes.json',
        // Repli quand aucun registre précis n'a pu être identifié : la page de la série entière,
        // à parcourir soi-même (pas d'équivalent du "browse par année seule" du Nord ici, ce
        // portail étant un arbre de classement plutôt qu'une recherche à facettes).
        catalogUrl: 'https://recherche-archives.tarn.fr/document/FRAD081_TablesSuccessionsAbsences',
    },
    '82': {
        label: 'Tarn-et-Garonne',
        kind: 'facet',
        // Bornes réelles de la série (224 registres scrapés, voir
        // scrape_successions_tarn_et_garonne.py) : contrairement à Nord/Tarn, seule la période
        // 1825-1969 est couverte par la "Table des successions et absences" proprement dite — la
        // table antérieure ("Table des successions acquittées") existe mais porte un autre nom et
        // n'est pas dépouillée ici (même logique que pour Le Fraysse au Tarn : mieux vaut aucune
        // piste qu'une piste sous un nom de série qu'on n'a pas vérifié).
        minYear: 1824,
        maxYear: 1969,
        registersUrl: './assets/data/successions_82.json',
        bureauxUrl: './assets/data/successions_82_bureaux.json',
        // Comme le Tarn, ce portail (même logiciel Anaphore) est un arbre de classement, pas une
        // recherche à facettes façon Nord : pas de "browse par année seule", repli sur la page de
        // la série entière.
        catalogUrl: 'https://recherche.archives82.fr/document/FRAD082_IR_00383',
    },
    '76': {
        label: 'Seine-Maritime',
        kind: 'facet',
        // Bornes réelles de la série (46 bureaux scrapés sur 47, voir
        // scrape_successions_seine_maritime.py) : structure la plus simple des quatre départements
        // couverts — un seul item numérisé par bureau (pas de subdivision par volume ni par
        // patronyme), directement le lien "bon registre" recherché.
        minYear: 1767,
        maxYear: 1970,
        registersUrl: './assets/data/successions_76.json',
        bureauxUrl: './assets/data/successions_76_bureaux.json',
        // Portail "Ligeo Archives" (Boscop), un troisième logiciel différent de Nord et
        // Tarn/Tarn-et-Garonne (Anaphore) : arbre de classement plutôt que recherche à facettes,
        // repli sur la liste des bureaux à parcourir soi-même.
        catalogUrl: 'https://www.archivesdepartementales76.net/n/enregistrement/n:275',
    },
    '37': {
        label: 'Indre-et-Loire',
        kind: 'facet',
        // Bornes réelles de la série (4554 registres scrapés, voir scrape_successions_multi.py).
        minYear: 1788,
        maxYear: 1969,
        portalBase: 'https://archives.touraine.fr/search/results',
        formUuid: 'f311e3b2-110c-43a5-a051-4585d7499fb9',
        registersUrl: './assets/data/successions_37.json',
        bureauxUrl: './assets/data/successions_37_bureaux.json',
    },
    '80': {
        label: 'Somme',
        kind: 'facet',
        // Bornes réelles de la série (434 registres scrapés, voir scrape_successions_multi.py).
        minYear: 1849,
        maxYear: 1968,
        portalBase: 'https://archives.somme.fr/search/results',
        formUuid: '93527461-9c14-4642-9a84-e3207e365911',
        registersUrl: './assets/data/successions_80.json',
        bureauxUrl: './assets/data/successions_80_bureaux.json',
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

// Lien de repli (Nord) quand aucun registre précis n'a pu être identifié (commune absente du
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

// Première lettre du patronyme, normalisée (majuscule, sans accent) pour matcher les tranches
// "Noms commençant par X" des répertoires alphabétiques (voir kind 'bureau-letter') ; null si le
// patronyme est vide ou ne commence pas par une lettre (particule détachée, chiffre...).
function firstSurnameLetter(surname) {
    if (!surname) return null;
    const s = surname.trim();
    if (!s) return null;
    const letter = normalizePlace(s.charAt(0)).toUpperCase();
    return /^[A-Z]$/.test(letter) ? letter : null;
}

const indexPromises = new Map();

function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
}

// kind 'facet' (Nord, Tarn-et-Garonne) : registres groupés par ville-siège de bureau + repli par
// proximité géographique commune -> bureau le plus proche (voir build_successions_*_bureaux.py).
function loadFacetIndex(config) {
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
        return { registerIndex, bureauIndex };
    });
}

// kind 'bureau-letter' (Tarn) : registres groupés par bureau PUIS par initiale de patronyme, et
// vraie table historique commune -> bureau (avec dates de bascule) publiée par le département —
// voir build_successions_tarn_communes.py, pas une approximation contrairement au repli du Nord.
function loadBureauLetterIndex(config) {
    return Promise.all([
        fetchJson(config.registersUrl),
        fetchJson(config.communesUrl).catch(() => ({})),
    ]).then(([registers, communes]) => {
        const registerIndex = new Map(); // bureauNorm -> Map(letter -> records[])
        registers.forEach(r => {
            const bureauKey = normalizePlace(r.bureau);
            if (!registerIndex.has(bureauKey)) registerIndex.set(bureauKey, new Map());
            const byLetter = registerIndex.get(bureauKey);
            if (!byLetter.has(r.letter)) byLetter.set(r.letter, []);
            byLetter.get(r.letter).push(r);
        });
        const communeHistory = new Map();
        Object.entries(communes).forEach(([communeNorm, history]) => {
            communeHistory.set(normalizePlace(communeNorm), history);
        });
        return { registerIndex, communeHistory };
    });
}

// Charge et indexe, pour un département donné, les données précalculées par son scraper. Un échec
// réseau n'est pas fatal : le département retombe simplement sur "aucune piste" plutôt que de
// bloquer toute l'analyse.
function loadDeptIndex(deptCodeKey) {
    const config = SUCCESSION_DEPTS[deptCodeKey];
    const loader = config.kind === 'bureau-letter' ? loadBureauLetterIndex : loadFacetIndex;
    return loader(config)
        .then(idx => ({ config, ...idx }))
        .catch(err => {
            console.error(`Chargement des successions (dept ${deptCodeKey}) échoué:`, err);
            return { config, registerIndex: new Map(), bureauIndex: new Map(), communeHistory: new Map() };
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

// Parmi les registres candidats (déjà filtrés sur la bonne ville-siège / le bon bureau+lettre),
// renvoie ceux dont la période couvre l'année recherchée (il peut y en avoir plusieurs : bureaux
// multiples d'une même ville, périodes redondantes/qui se chevauchent...) ; à défaut, le registre
// le plus proche dans le temps, pour ne jamais renvoyer une piste vide quand des registres
// existent bel et bien pour cette commune, juste pas pile sur cette année (bornes de registre
// imprécises, calendrier républicain converti approximativement).
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

function resolveFacet(idx, geo, year) {
    const cityNorm = normalizePlace(geo.city);
    const exact = idx.registerIndex.get(cityNorm);
    if (exact && exact.length) {
        return { matchType: 'exact', registers: pickRegisters(exact, year), bureauInfo: null, contextLabel: null };
    }
    const bureauInfo = idx.bureauIndex.get(cityNorm) || null;
    const viaBureau = bureauInfo ? idx.registerIndex.get(normalizePlace(bureauInfo.bureau)) : null;
    if (viaBureau && viaBureau.length) {
        return { matchType: 'bureau', registers: pickRegisters(viaBureau, year), bureauInfo, contextLabel: null };
    }
    return { matchType: 'none', registers: [], bureauInfo: null, contextLabel: null };
}

function resolveBureauLetter(idx, geo, year, person) {
    const cityNorm = normalizePlace(geo.city);
    const history = idx.communeHistory.get(cityNorm);
    const bureau = history ? (history.find(h => year >= h.yearStart && year <= h.yearEnd) || {}).bureau : null;
    if (!bureau) {
        return { matchType: 'none', registers: [], bureauInfo: null, contextLabel: null };
    }
    const letter = firstSurnameLetter(person.surname);
    const byLetter = idx.registerIndex.get(normalizePlace(bureau));
    const candidates = letter && byLetter ? byLetter.get(letter) : null;
    if (candidates && candidates.length) {
        return {
            matchType: 'exact', registers: pickRegisters(candidates, year), bureauInfo: null,
            contextLabel: `Bureau de ${bureau} — noms commençant par ${letter}`,
        };
    }
    return {
        matchType: 'none', registers: [], bureauInfo: null,
        contextLabel: letter ? `Bureau de ${bureau} (aucun registre pour "${letter}")` : `Bureau de ${bureau} (patronyme inconnu)`,
    };
}

// Seul le décès donne lieu à une déclaration de succession (contrairement au notariat, un mariage
// n'en produit pas) : uniquement l'événement DEAT est considéré ici.
// indexes: Map département -> {config, ...} (voir loadSuccessionIndexes)
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
        const { config } = idx;
        if (year < config.minYear || year > config.maxYear) return; // hors des bornes de la série

        const resolved = config.kind === 'bureau-letter'
            ? resolveBureauLetter(idx, geo, year, p)
            : resolveFacet(idx, geo, year);

        results.push({
            person: p, year, city: geo.city, dept: dc, deptLabel: config.label,
            ...resolved,
            // Le repli dépend de ce que le portail sait faire, pas de la mécanique de
            // correspondance (kind) : formUuid signale un portail à recherche par facettes
            // (Nord — peut filtrer par année seule), les autres sont des arbres de classement
            // (Tarn, Tarn-et-Garonne — repli sur la page de la série entière, catalogUrl).
            fallbackUrl: resolved.registers.length ? null
                : (config.formUuid ? buildYearOnlySearchUrl(config, year) : config.catalogUrl),
        });
    });
    return results;
}
