import { deptCode, deptName, normalizePlace } from './geo.js';
import { estimateBirthYear } from './inference.js';

// Départements dont les tables de recensement nominatif sont indexées par la base de noms
// FranceArchives ("basedenoms_recensement"), par code INSEE (plus fiable que par nom : évite tout
// problème d'apostrophe typographique ou d'alias historique). Valeurs par défaut, modifiables
// depuis l'interface (voir parseDeptCodesInput).
export const RECENSEMENT_DEPT_CODES_DEFAULT = [
    '02','03','04','05','06','11','16','18','21','22','23','24','27','28','29','30','32','33','34','35',
    '36','40','42','43','45','46','47','51','52','54','55','56','57','58','60','62','63','66','69','70',
    '71','73','74','77','78','81','82','83','84','85','86','87','88','90','93','94','95'
];

// Correspondance code INSEE -> identifiant "es_service" (service producteur/détenteur) de
// FranceArchives : un identifiant interne à leur CMS, propre à chaque service d'archives
// départementales, sans rapport avec le code INSEE et non dérivable par formule. Recueilli à la
// main depuis la facette "Service" affichée sur la base de noms "recensement"
// (https://francearchives.gouv.fr/fr/basedenoms_recensement), état du 2026-08. Quand ce filtre est
// disponible pour un département, il cible directement le bon fonds sans dépendre de la
// reconnaissance du nom de département par l'index texte (voir buildFranceArchivesUrl) ; pour un
// département absent d'ici, on retombe sur le filtre texte es_locations existant.
const ES_SERVICE_BY_DEPT = {
    '02': '33366', '03': '33374', '04': '33381', '05': '33390', '06': '33398', '11': '33445',
    '16': '33511', '18': '33528', '21': '33541', '22': '33555', '23': '33560', '24': '33565',
    '27': '33592', '28': '33606', '29': '33616', '30': '33629', '32': '33656', '33': '33661',
    '34': '33680', '35': '33695', '36': '33704', '40': '33752', '42': '33766', '43': '33779',
    '45': '33801', '46': '33815', '47': '33820', '51': '33850', '52': '33857', '54': '33867',
    '55': '33877', '56': '33887', '57': '33901', '58': '33915', '60': '33951', '62': '33969',
    '63': '33985', '66': '34005', '69': '34051', '70': '34079', '71': '34085', '73': '34097',
    '74': '34110', '77': '34157', '78': '34189', '81': '34235', '82': '34241', '83': '34245',
    '84': '34265', '85': '34282', '86': '34295', '87': '34302', '88': '34309', '90': '34324',
    '93': '34393', '94': '34430', '95': '34471'
};

// Dates des recensements nominatifs français couverts par FranceArchives : quinquennaux, avec les
// décalages historiques réels (1871 reporté à 1872 après la guerre franco-prussienne, pas de
// recensement en 1916 ni 1941 du fait des deux guerres mondiales). Valeurs par défaut, modifiables
// depuis l'interface (voir parseCensusDatesInput).
export const RECENSEMENT_DATES_DEFAULT = [
    1836,1841,1846,1851,1856,1861,1866,1872,1876,1881,1886,1891,1896,1901,1906,1911,1921,1926,1931,1936
];

// Un recensement acté (à ±1 an près, un passage pouvant être consigné à cheval sur deux années
// civiles) sur une date cible compte comme "déjà trouvé" pour cette date précise : inutile de
// proposer un lien de recherche pour une année déjà documentée dans le GEDCOM.
const CENS_YEAR_TOLERANCE = 1;

// --- Normalisation des listes éditables (départements / dates de recensement) ---
export function normalizeDeptCode(token) {
    const t = (token || '').trim().toUpperCase();
    if (!t) return null;
    if (/^2[AB]$/.test(t)) return t; // Corse
    if (/^\d{1,3}$/.test(t)) return t.length === 3 ? t : t.padStart(2, '0'); // "2" -> "02", DOM "971" inchangé
    return t;
}
export function parseDeptCodesInput(text) {
    return Array.from(new Set((text || '').split(/[,;\s]+/).map(normalizeDeptCode).filter(Boolean)));
}
export function parseCensusDatesInput(text) {
    return Array.from(new Set((text || '').split(/[,;\s]+/).map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n)))).sort((a, b) => a - b);
}

// Remonte au père/mère, conjoint(e)(s) et enfants de la personne : affichés à côté de chaque piste
// pour aider à confirmer, une fois le registre de recensement ouvert sur FranceArchives, qu'il
// s'agit bien du bon foyer (le recensement liste tout le ménage : conjoint, enfants, parents s'ils
// cohabitent), plutôt que de se fier au seul nom/prénom/commune tronqués.
function getValidationInfo(p, map, fams) {
    const spouses = [];
    const children = [];
    (p.fams || []).forEach(famId => {
        const fam = fams.get(famId);
        if (!fam) return;
        const spouseId = fam.husb === p.id ? fam.wife : (fam.wife === p.id ? fam.husb : null);
        const spouse = spouseId ? map.get(spouseId) : null;
        if (spouse) spouses.push(spouse.name);
        (fam.children || []).forEach(cid => {
            const c = map.get(cid);
            if (c) children.push(c.name);
        });
    });
    const father = p.fatherId ? map.get(p.fatherId) : null;
    const mother = p.motherId ? map.get(p.motherId) : null;
    return {
        spouses,
        children,
        father: father ? father.name : null,
        mother: mother ? mother.name : null
    };
}

// opts: { ancestorScopeSet, deptCodes: string[], censusDates: number[], maxAge: number }
export function computeMissingRecensements(list, map, fams, opts) {
    opts = opts || {};
    const deptCodes = new Set((opts.deptCodes && opts.deptCodes.length) ? opts.deptCodes : RECENSEMENT_DEPT_CODES_DEFAULT);
    const censusDates = ((opts.censusDates && opts.censusDates.length) ? opts.censusDates : RECENSEMENT_DATES_DEFAULT).slice().sort((a, b) => a - b);
    if (!censusDates.length) return [];
    // Au-delà de cet âge à la date du recensement, l'estimation de naissance est plus probablement
    // erronée qu'une réelle longévité (défaut 100 ans) : on écarte la piste plutôt que de proposer
    // une recherche pour quelqu'un qui, en réalité, était déjà décédé ou jamais né à cette date.
    const maxAge = opts.maxAge != null ? opts.maxAge : 100;
    const periodStart = censusDates[0], periodEnd = censusDates[censusDates.length - 1];

    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;

        // Pré-filtre rapide : la personne doit avoir pu être vivante à un moment ou un autre de la
        // plage de dates retenue, sans quoi aucune date individuelle ne passera de toute façon.
        const birthEst = estimateBirthYear(p, map, fams);
        if (!birthEst) return;
        if (birthEst.year > periodEnd) return;
        if (p.death.year != null && p.death.year < periodStart) return;

        // Frontière avant/après mariage : avant (ou si aucun mariage connu, systématiquement), on
        // suppose la personne dans sa commune de naissance ; après, dans sa commune de décès (son
        // dernier lieu de vie connu), avec repli sur la commune de mariage puis, à défaut, la
        // naissance à nouveau.
        const marriageYear = p.marrYear != null ? p.marrYear : Infinity;

        const hits = [];
        censusDates.forEach(year => {
            if (year < birthEst.year) return; // pas encore né(e) à cette date
            if (p.death.year != null && year > p.death.year) return; // déjà décédé(e) à cette date
            if (year - birthEst.year > maxAge) return; // âge estimé au-delà du maximum plausible

            const already = p.censusEvents.some(e => e.year != null && Math.abs(e.year - year) <= CENS_YEAR_TOLERANCE);
            if (already) return; // déjà acté dans le GEDCOM pour cette date : rien à chercher

            let geo, source;
            if (year < marriageYear) { geo = p.birth.geo; source = 'naissance'; }
            else if (p.death.geo) { geo = p.death.geo; source = 'décès'; }
            else if (p.marrGeo) { geo = p.marrGeo; source = 'mariage'; }
            else { geo = p.birth.geo; source = 'naissance'; }

            if (!geo || !geo.dept) return;
            if (!deptCodes.has(deptCode(geo.dept))) return;

            // Lieu parent (voir geo.cityChain dans gedcom.js) : le segment le plus général avant le
            // département, quasi-toujours la commune elle-même — utile en repli quand le lieu le plus
            // précis (souvent un lieu-dit/hameau) n'est pas reconnu par l'index FranceArchives.
            const cityAlt = (geo.cityChain && geo.cityChain.length > 1) ? geo.cityChain[geo.cityChain.length - 1] : null;
            hits.push({ year, city: geo.city, cityAlt, dept: geo.dept, source });
        });
        if (!hits.length) return;

        results.push({ person: p, birthEst, hits, validation: getValidationInfo(p, map, fams) });
    });
    return results;
}

// Les recensements FranceArchives sont indexés par OCR sur des registres manuscrits : les
// transcriptions automatiques comportent fréquemment des erreurs, en particulier en fin de mot
// (finales avalées, accents mal reconnus...). On tronque donc chaque mot et on le termine par "*"
// (troncature multi-caractères, syntaxe documentée par FranceArchives) plutôt que de chercher
// l'orthographe exacte telle qu'actée dans le GEDCOM — au prix de plus de résultats à trier
// soi-même, mais sans risquer de rater la bonne personne à cause d'une seule lettre mal OCRisée.
// En dessous de 3 lettres il n'y a plus rien à gagner à tronquer davantage : testé manuellement sur
// FranceArchives, "~" (mot entier, sans troncature) y élargit mieux la recherche que "*" sur un
// radical aussi court.
function fuzzyToken(word) {
    const w = word.trim();
    if (w.length <= 3) return w + '~';
    const keepLen = Math.max(3, Math.min(Math.ceil(w.length * 0.7), w.length - 1));
    return w.slice(0, keepLen) + '*';
}
// Un champ peut contenir plusieurs mots (patronymes à particule...) : chacun est tronqué
// séparément puis rejoint par un espace — dans la syntaxe FranceArchives, l'opérateur entre
// plusieurs mots d'un même champ Nom/Prénoms est "OU".
function fuzzyField(text) {
    if (!text) return '';
    return text.trim().split(/\s+/).map(fuzzyToken).join(' ');
}
// Sur le champ Prénoms, l'opérateur "~" entre prénoms entiers (sans troncature "*") s'est montré
// plus efficace que la troncature, vérifié manuellement sur FranceArchives ("Fernand~Paul~Georges").
// Quand plusieurs prénoms sont actés (ex. "Marie Louise"), la personne peut être enregistrée au
// recensement sous un seul d'entre eux : on les OU donc tous ensemble en un seul groupe plutôt que
// d'ouvrir un lien de recherche par prénom.
function fuzzyForenameField(text) {
    if (!text) return '';
    return text.trim().split(/\s+/).filter(Boolean).join('~');
}

// La correspondance "quel notaire a pu dresser l'acte de mariage/décès de cet ancêtre" vit
// désormais dans notaires.js (base FranceGenWeb, commune + période, avec lien direct par fiche) :
// voir computeNotarialActLeads. Elle a remplacé une première version basée sur l'outil Sparnatural
// de FranceArchives, qui ne pouvait interroger que "cette personne a-t-elle elle-même produit un
// acte en tant que notaire" faute d'index nominatif sur les minutes.

// OU-e (syntaxe FranceArchives "~", sans guillemets) plusieurs libellés de lieu candidats en un
// seul terme de recherche, sans doublon — utilisé pour élargir es_locations à la commune parente
// (cityAlt, voir geo.cityChain dans gedcom.js) et/ou au département quand le lieu le plus précis
// acté (souvent un lieu-dit/hameau) n'est pas reconnu tel quel par l'index.
function orLocations(...names) {
    const seen = new Set();
    const parts = [];
    names.forEach(n => {
        if (!n) return;
        const key = normalizePlace(n);
        if (seen.has(key)) return;
        seen.add(key);
        parts.push(n);
    });
    return parts.length ? parts.join('~') : null;
}

// Lien pré-rempli vers la base de noms "recensement" de FranceArchives, ciblé sur UNE année de
// recensement précise (es_date_min = es_date_max = cette année, puisqu'on sait déjà exactement
// quel recensement chercher) et le département (`dept`, au format "XX - Nom" tel que stocké par
// analyzePlace) utilisé en secours quand la commune (`city`) n'est pas reconnue par l'index.
// `cityAlt` (optionnel) est le lieu parent de `city` (ex. la commune quand `city` est un lieu-dit
// qui en dépend) : OU-é avec lui pour élargir la recherche sans devoir deviner lequel des deux
// libellés l'index FranceArchives reconnaît.
export function buildFranceArchivesUrl(p, city, censusYear, dept, cityAlt) {
    const params = new URLSearchParams();
    if (p.surname) params.set('es_names', fuzzyField(p.surname));
    if (p.given) params.set('es_forenames', fuzzyForenameField(p.given));
    const serviceId = ES_SERVICE_BY_DEPT[deptCode(dept)];
    if (serviceId) {
        // Le service producteur cible directement le bon fonds départemental : plus besoin d'OU-er
        // le nom du département dans es_locations en secours, il ne reste qu'à préciser la commune
        // si elle est connue.
        params.set('es_service', serviceId);
        const loc = orLocations(city, cityAlt);
        if (loc) params.set('es_locations', loc);
    } else {
        // Pas d'identifiant de service connu pour ce département : on retombe sur le texte, en OU-ant
        // le nom de la commune (pas toujours reconnu par l'index : graphie ancienne, fusion de
        // communes...) avec celui du département en secours, vérifié manuellement sur FranceArchives
        // ("Belleville~Rhône", sans guillemets).
        const dn = deptName(dept);
        const loc = orLocations(city, cityAlt, dn);
        if (loc) params.set('es_locations', loc);
    }
    if (p.sex === 'M' || p.sex === 'F') params.set('es_gender', p.sex === 'M' ? 'h' : 'f');
    if (censusYear != null) {
        params.set('es_date_min', censusYear);
        params.set('es_date_max', censusYear);
    }
    params.set('fulltext_facet', '');
    return `https://francearchives.gouv.fr/fr/basedenoms_recensement?${params.toString()}`;
}
