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

            hits.push({ year, city: geo.city, dept: geo.dept, source });
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

// --- Recherche via l'outil Sparnatural (archives notariales, FranceArchives) ---
// L'outil Sparnatural (https://francearchives.gouv.fr/fr/requeteurnaturel) interroge par SPARQL
// un réservoir RiC-O distinct de la base de noms utilisée ci-dessus pour les recensements : il n'y
// a pas de recherche nominative directe dans les actes notariés (les minutes ne sont pas indexées
// personne par personne), mais on peut chercher les DOCUMENTS PRODUITS PAR une Personne dont
// l'activité est "notaire", ce qui permet de repérer si un ascendant a lui-même exercé cette
// charge. Les prédicats ci-dessous ont été vérifiés en capturant l'URL réellement générée par
// l'outil après une recherche manuelle (le bouton de partage encode la requête SPARQL en clair
// dans le fragment #query=, sans compression) :
//   hasProvenance            Archives -> Personne (producteur)
//   performsOrPerformed/hasActivityType   Personne -> activité (ici : notaire)
//   beginningDate             Archives -> date
//   isOrWasIncludedIn         Archives -> Inventaire parent (toujours présent dans les requêtes
//                             capturées, y compris sans contrainte dessus ; reproduit tel quel)
// Une première version tentait aussi de filtrer par commune (Lieu -> rdfs:label -> bif:contains,
// en texte libre) : ce triplet n'a jamais été observé dans une requête réelle, contrairement au
// filtre par Personne/Nom ci-dessous — seule la résolution vers l'URI exacte de l'autorité lieu
// FranceArchives (vue dans un exemple sous la forme https://francearchives.gouv.fr/location/<id>,
// résolue par l'autocomplete du portail lors de la saisie manuelle) l'a été. Cette résolution n'est
// pas reproductible côté client (le portail bloque les requêtes automatisées), et le filtre en
// texte libre inventé pour la remplacer s'est avéré renvoyer une recherche vide une fois testé :
// la commune n'est donc plus incluse dans la requête, seulement indiquée en clair à côté du lien
// (voir computeNotarialLeads), à ajouter à la main dans l'outil au besoin.
const RIC = 'https://www.ica.org/standards/RiC/ontology#';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const BIF_CONTAINS = 'http://www.openlinksw.com/schemas/bif#contains';
// URI FranceArchives (thésaurus interne) du concept "notaire", capturée dans une requête réelle
// filtrant sur l'activité d'une Personne. Opaque mais stable (identifiant d'autorité).
const NOTAIRE_ACTIVITY_URI = 'https://francearchives.gouv.fr/externaluri/d3nyu9x713-9kcjiv44l4wh';

// Échappe et entoure une valeur pour l'opérateur plein texte Virtuoso bif:contains utilisé par
// Sparnatural pour filtrer le rdfs:label d'une Personne : la valeur doit être entre guillemets
// simples (syntaxe Virtuoso), eux-mêmes insérés dans un littéral SPARQL entre guillemets doubles.
// Un seul mot (le nom de famille), sans troncature ni combinaison "AND" : c'est exactement la forme
// vue dans les deux requêtes réelles ayant servi de modèle, gage de fiabilité maximale.
function bifContainsLiteral(text) {
    const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    return `"'${escaped}'"`;
}
function sparqlBoundIso(year, isUpperBound) {
    return `${year}-${isUpperBound ? '12-31T23:59:59' : '01-01T00:00:00'}Z`;
}

// Requête SPARQL "Document d'archives produit par une Personne dont l'activité est notaire et
// dont le nom contient nameTerm, daté entre yearFrom et yearTo" — reproduit fidèlement la
// structure d'une requête réellement générée par l'outil (voir commentaire ci-dessus).
export function buildSparnaturalNotaireQuery(nameTerm, yearFrom, yearTo) {
    const name = (nameTerm || '').trim();
    if (!name || yearFrom == null || yearTo == null) return null;
    return `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?Archives_1 ?Archives_1_label WHERE {
  ?Archives_1 rdf:type <${RIC}RecordResource>;
    <${RIC}isOrWasIncludedIn> _:g1.
  OPTIONAL { ?Archives_1 <${RIC}title> ?Archives_1_label. }
  ?Archives_1 <${RIC}hasProvenance> ?Personne_2.
  ?Personne_2 rdf:type <${RIC}Person>;
    (<${RIC}performsOrPerformed>/<${RIC}hasActivityType>) <${NOTAIRE_ACTIVITY_URI}>;
    <${RDFS_LABEL}> ?Nom_7.
  ?Nom_7 <${BIF_CONTAINS}> ${bifContainsLiteral(name)}.
  ?Archives_1 <${RIC}beginningDate> ?Date_10.
  FILTER(((xsd:dateTime(?Date_10)) >= "${sparqlBoundIso(yearFrom, false)}"^^xsd:dateTime) && ((xsd:dateTime(?Date_10)) <= "${sparqlBoundIso(yearTo, true)}"^^xsd:dateTime))
}
LIMIT 1000`;
}
export function buildSparnaturalNotaireUrl(nameTerm, yearFrom, yearTo) {
    const query = buildSparnaturalNotaireQuery(nameTerm, yearFrom, yearTo);
    return query ? `https://francearchives.gouv.fr/fr/requeteurnaturel#query=${encodeURIComponent(query)}` : null;
}

// Pour chaque personne, un lien Sparnatural cherchant si CETTE personne a pu exercer comme notaire
// (nom de famille + activité), sur toute sa période d'activité adulte plausible (15 ans après sa
// naissance estimée, jusqu'à son décès ou, à défaut, jusqu'à maxAge ans). Les communes connues
// (naissance, mariage, décès — dédupliquées par nom) sont fournies à titre indicatif à côté du
// lien : la requête ne peut pas les y intégrer directement (voir commentaire plus haut), mais elles
// aident à choisir rapidement, une fois l'outil ouvert, le lieu à ajouter à la main si besoin.
// Contrairement aux recensements, il n'y a pas d'état "déjà documenté" à exclure : les registres
// notariés ne sont pas des événements actés dans le GEDCOM, donc un lien est proposé dès qu'un nom
// de famille et une naissance (actée ou estimée) sont disponibles.
// opts: { ancestorScopeSet, maxAge }
export function computeNotarialLeads(list, map, fams, opts) {
    opts = opts || {};
    const maxAge = opts.maxAge != null ? opts.maxAge : 100;
    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;
        if (!p.surname) return; // la recherche porte sur le nom du producteur : indispensable

        const birthEst = estimateBirthYear(p, map, fams);
        if (!birthEst) return;
        const yearFrom = birthEst.year + 15;
        const yearTo = p.death.year != null ? p.death.year : birthEst.year + maxAge;
        if (yearFrom > yearTo) return;

        const url = buildSparnaturalNotaireUrl(p.surname, yearFrom, yearTo);
        if (!url) return;

        const places = [];
        const seenCities = new Set();
        const addPlace = (geo, source) => {
            if (!geo || !geo.city) return;
            const key = geo.city.toLowerCase();
            if (seenCities.has(key)) return;
            seenCities.add(key);
            places.push({ city: geo.city, dept: geo.dept, source });
        };
        addPlace(p.birth.geo, 'naissance');
        addPlace(p.marrGeo, 'mariage');
        addPlace(p.death.geo, 'décès');

        results.push({ person: p, birthEst, yearFrom, yearTo, url, places });
    });
    return results;
}

// Lien pré-rempli vers la base de noms "recensement" de FranceArchives, ciblé sur UNE année de
// recensement précise (es_date_min = es_date_max = cette année, puisqu'on sait déjà exactement
// quel recensement chercher) et le département (`dept`, au format "XX - Nom" tel que stocké par
// analyzePlace) utilisé en secours quand la commune (`city`) n'est pas reconnue par l'index.
export function buildFranceArchivesUrl(p, city, censusYear, dept) {
    const params = new URLSearchParams();
    if (p.surname) params.set('es_names', fuzzyField(p.surname));
    if (p.given) params.set('es_forenames', fuzzyForenameField(p.given));
    // Le nom de commune n'est pas toujours reconnu par l'index (graphie ancienne, fusion de
    // communes...) : on l'OU avec le nom du département en secours, vérifié manuellement sur
    // FranceArchives ("Belleville~Rhône", sans guillemets).
    const dn = deptName(dept);
    if (city && dn) params.set('es_locations', `${city}~${dn}`);
    else if (city) params.set('es_locations', city);
    else if (dn) params.set('es_locations', dn);
    if (p.sex === 'M' || p.sex === 'F') params.set('es_gender', p.sex === 'M' ? 'h' : 'f');
    if (censusYear != null) {
        params.set('es_date_min', censusYear);
        params.set('es_date_max', censusYear);
    }
    params.set('fulltext_facet', '');
    return `https://francearchives.gouv.fr/fr/basedenoms_recensement?${params.toString()}`;
}
