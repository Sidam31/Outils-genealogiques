// --- Recherche plein texte Gallica (BnF) ---
// Gallica indexe un fonds très hétérogène (presse ancienne, monographies, manuscrits, actes...) via
// une API SRU/CQL (https://api.bnf.fr/fr/api-gallica-de-recherche). Contrairement à FranceArchives
// (voir recensements.js), il n'existe pas d'index géographique fiable et documenté couvrant
// l'ensemble de ces fonds : le filtre "département" proposé ici reste donc une approximation (terme
// de recherche libre complémentaire), alors que le filtre de date s'appuie sur le champ dc.date,
// documenté et fiable (comparateurs >=/<=).
import { deptName } from './geo.js';
import { estimateBirthYear } from './inference.js';

const GALLICA_SRU_URL = 'https://gallica.bnf.fr/services/engine/search/sru';

// Distance maximale (en mots) tolérée entre nom et prénom dans le texte (voir prox/unit=word/
// distance=2 du lien Gallica d'origine) : couvre un ordre inversé ou un mot intercalé (particule,
// second prénom, titre de civilité...) sans exiger la séquence exacte "Prénom Nom".
const PROX_DISTANCE = 2;

function cqlEscape(s) {
    return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Plage [min, max] à passer à dc.date : naissance (actée, sinon estimée) et décès, chacune élargie
// de `margin` années pour couvrir l'incertitude d'estimation et le délai de publication (annonce,
// faire-part, article nécrologique...). Repli sur l'unique borne connue élargie des deux côtés si
// l'autre événement est inconnu ; aucune plage si ni l'une ni l'autre n'est disponible.
export function gallicaDateRange(p, map, fams, margin) {
    const birthEst = estimateBirthYear(p, map, fams);
    const birthYear = p.birth?.year ?? birthEst?.year ?? null;
    const deathYear = p.death?.year ?? null;
    if (birthYear == null && deathYear == null) return null;
    const m = margin != null ? margin : 5;
    return { min: (birthYear ?? deathYear) - m, max: (deathYear ?? birthYear) + m };
}

// Nom de département (ex. "Gironde") à utiliser comme terme de recherche libre complémentaire,
// priorité à la naissance, repli sur le décès.
export function gallicaDeptLabel(p) {
    return deptName(p.birth?.geo?.dept || p.death?.geo?.dept || null);
}

// Un GEDCOM acte souvent plusieurs prénoms ("Marie Louise Joséphine") dans un seul champ p.given :
// contrairement à FranceArchives (index dédié, voir fuzzyForenameField dans recensements.js), la
// syntaxe CQL de Gallica ne permet pas de "OU-er" proprement plusieurs prénoms complets dans une
// seule requête prox — on propose donc un lien par prénom plutôt qu'une phrase à rallonge qui
// n'aurait de sens que si tous étaient accolés tels quels dans le document recherché.
export function personForenames(p) {
    const given = (p.given || '').trim();
    if (!given) return [''];
    return Array.from(new Set(given.split(/\s+/).filter(Boolean)));
}

// Nom(s) "de mariage" d'une femme : le patronyme de son ou ses époux successifs (via les familles où
// elle apparaît comme "wife"), distinct(s) de son nom de naissance — la presse ancienne et nombre
// d'actes la désignent couramment sous son nom d'épouse plutôt que de jeune fille.
export function marriedSurnames(p, map, fams) {
    if (p.sex !== 'F' || !p.fams || !p.fams.length) return [];
    const birthSurname = (p.surname || '').trim().toLowerCase();
    const names = new Set();
    p.fams.forEach(famId => {
        const fam = fams.get(famId);
        if (!fam || fam.wife !== p.id) return;
        const husb = fam.husb ? map.get(fam.husb) : null;
        const s = (husb?.surname || '').trim();
        if (s && s.toLowerCase() !== birthSurname) names.add(s);
    });
    return Array.from(names);
}

// Combinaisons (nom, prénom) à proposer en recherche pour une personne : un lien par prénom acté
// (voir personForenames) sous son nom de naissance, puis les mêmes déclinaisons sous chaque nom de
// mariage connu (voir marriedSurnames) pour une femme.
export function nameVariants(p, map, fams) {
    const forenames = personForenames(p);
    const surnameGroups = [
        { surname: (p.surname || '').trim(), married: false },
        ...marriedSurnames(p, map, fams).map(s => ({ surname: s, married: true }))
    ];
    const variants = [];
    surnameGroups.forEach(({ surname, married }) => {
        forenames.forEach(given => {
            if (!surname && !given) return;
            variants.push({ surname, given, married });
        });
    });
    return variants;
}

// opts: { useDate, dateRange: {min,max}, useDept, deptLabel }
export function buildGallicaUrl(surname, given, opts) {
    opts = opts || {};
    surname = cqlEscape((surname || '').trim());
    given = cqlEscape((given || '').trim());
    if (!surname && !given) return null;

    const nameClause = (surname && given)
        ? `text all "${surname}" prox/unit=word/distance=${PROX_DISTANCE} "${given}"`
        : `text all "${surname || given}"`;
    const clauses = [`(${nameClause})`];

    if (opts.useDate && opts.dateRange) {
        clauses.push(`(dc.date>="${opts.dateRange.min}" and dc.date<="${opts.dateRange.max}")`);
    }
    if (opts.useDept && opts.deptLabel) {
        clauses.push(`(text all "${cqlEscape(opts.deptLabel)}")`);
    }

    const params = new URLSearchParams({
        operation: 'searchRetrieve',
        exactSearch: 'true',
        collapsing: 'true',
        version: '1.2',
        query: `(${clauses.join(' and ')})`,
        suggest: '10',
        keywords: ''
    });
    return `${GALLICA_SRU_URL}?${params.toString()}`;
}

// opts: { ancestorScopeSet, useDate, dateMargin, useDept }
export function computeGallicaLeads(list, map, fams, opts) {
    opts = opts || {};
    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;
        if (!p.surname && !p.given) return;

        const birthEst = estimateBirthYear(p, map, fams);
        const dateRange = gallicaDateRange(p, map, fams, opts.dateMargin);
        const deptLabel = gallicaDeptLabel(p);
        const dateApplied = !!(opts.useDate && dateRange);
        const deptApplied = !!(opts.useDept && deptLabel);
        const urlOpts = { useDate: dateApplied, dateRange, useDept: deptApplied, deptLabel };

        // Un filtre activé mais sans donnée exploitable pour cette personne (date ou département
        // inconnu) n'exclut pas la ligne : il n'est simplement pas appliqué à ses liens, qui restent
        // valides sans lui (voir dateApplied/deptApplied, affichés pour que ce soit visible).
        const links = nameVariants(p, map, fams)
            .map(v => ({
                url: buildGallicaUrl(v.surname, v.given, urlOpts),
                surname: v.surname,
                given: v.given,
                married: v.married
            }))
            .filter(l => l.url);
        if (!links.length) return;

        results.push({ person: p, birthEst, dateRange, deptLabel, dateApplied, deptApplied, links });
    });
    return results;
}
