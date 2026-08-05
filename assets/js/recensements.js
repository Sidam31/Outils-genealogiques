import { deptCode, deptName } from './geo.js';
import { estimateBirthYear } from './inference.js';

// Départements dont les tables de recensement nominatif sont indexées par la base de noms
// FranceArchives ("basedenoms_recensement"), par code INSEE (plus fiable que par nom : évite tout
// problème d'apostrophe typographique ou d'alias historique). Valeurs par défaut, modifiables
// depuis l'interface (voir parseDeptCodesInput).
export const RECENSEMENT_DEPT_CODES_DEFAULT = [
    '02','03','11','16','21','23','24','27','29','30','32','33','34','35','36','42','43','45','46','47',
    '51','52','54','55','56','57','58','60','62','63','66','69','70','71','73','74','77','78','82','83',
    '84','85','86','87','88','90','93','94','95'
];

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

            hits.push({ year, city: geo.city || geo.dept, dept: geo.dept, source });
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
// Sur le champ Prénoms, "~" (mot entier, sans troncature) s'est montré plus efficace que "*" lors
// des tests manuels sur FranceArchives, quelle que soit la longueur du prénom.
function fuzzyForename(word) {
    return (word || '').trim() + '~';
}

// Quand plusieurs prénoms sont actés (ex. "Marie Louise"), la personne peut être enregistrée au
// recensement sous un seul d'entre eux : on propose donc un lien de recherche PAR prénom plutôt
// qu'un unique lien combinant tous les prénoms (qui, faute d'opérateur "ET" entre eux dans ce
// champ, ne cible pas mieux la bonne personne et dilue la troncature floue). Renvoie [null] quand
// il n'y a aucun prénom connu (un seul lien, sans filtre prénom).
export function givenNameOptions(p) {
    if (!p.given) return [null];
    const words = p.given.trim().split(/\s+/).filter(Boolean);
    return words.length ? words : [null];
}

// Lien pré-rempli vers la base de noms "recensement" de FranceArchives, ciblé sur UNE année de
// recensement précise (es_date_min = es_date_max = cette année, puisqu'on sait déjà exactement
// quel recensement chercher), UN prénom (`forename`, choisi parmi givenNameOptions(p), ou null
// pour ne pas filtrer par prénom) et le département (`dept`, au format "XX - Nom" tel que stocké
// par analyzePlace) utilisé en secours quand la commune (`city`) n'est pas reconnue par l'index.
export function buildFranceArchivesUrl(p, city, censusYear, forename, dept) {
    const params = new URLSearchParams();
    if (p.surname) params.set('es_names', fuzzyField(p.surname));
    if (forename) params.set('es_forenames', fuzzyForename(forename));
    // Le nom de commune n'est pas toujours reconnu par l'index (graphie ancienne, fusion de
    // communes...) : on l'OU, en phrase exacte, avec le nom du département en secours.
    const dn = deptName(dept);
    if (city && dn) params.set('es_locations', `"${city}"~"${dn}"`);
    else if (city) params.set('es_locations', `"${city}"`);
    else if (dn) params.set('es_locations', `"${dn}"`);
    if (p.sex === 'M' || p.sex === 'F') params.set('es_gender', p.sex === 'M' ? 'h' : 'f');
    if (censusYear != null) {
        params.set('es_date_min', censusYear);
        params.set('es_date_max', censusYear);
    }
    params.set('fulltext_facet', '');
    return `https://francearchives.gouv.fr/fr/basedenoms_recensement?${params.toString()}`;
}
