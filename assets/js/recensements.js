import { deptCode } from './geo.js';
import { estimateBirthYear } from './inference.js';

// Départements dont les tables de recensement nominatif sont indexées par la base de noms
// FranceArchives ("basedenoms_recensement"), par code INSEE (plus fiable que par nom : évite tout
// problème d'apostrophe typographique ou d'alias historique).
export const RECENSEMENT_DEPT_CODES = new Set([
    '02','03','11','16','21','23','24','27','29','30','32','33','34','35','36','42','43','45','46','47',
    '51','52','54','55','56','57','58','60','62','63','66','69','70','71','73','74','77','78','82','83',
    '84','85','86','87','88','90','93','94','95'
]);

// Période couverte par les recensements nominatifs français : une personne née après 1936 ou
// décédée avant 1836 n'a par construction pas pu y être recensée.
export const RECENSEMENT_PERIOD_START = 1836;
export const RECENSEMENT_PERIOD_END = 1936;

const HIT_LABELS = { BIRT: 'Naissance', MARR: 'Mariage', DEAT: 'Décès' };

// opts: { ancestorScopeSet }
export function computeMissingRecensements(list, map, fams, opts) {
    opts = opts || {};
    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;
        if (p.events.CENS.hasTag) return; // déjà un recensement acté

        // Filtre obligatoire : la personne doit avoir pu être vivante pendant la période couverte
        // par les recensements nominatifs (1836-1936), sans quoi elle ne peut de toute façon y
        // figurer — sans naissance connue ou déductible, on ne peut pas vérifier cette condition,
        // donc on exclut par prudence plutôt que de lister une piste invérifiable.
        const birthEst = estimateBirthYear(p, map, fams);
        if (!birthEst) return;
        if (birthEst.year > RECENSEMENT_PERIOD_END) return;
        if (p.death.year != null && p.death.year < RECENSEMENT_PERIOD_START) return;

        // Événement(s) situés dans un département couvert : naissance, mariage ou décès.
        const hits = [];
        const seenCities = new Set();
        const addHit = (type, geo) => {
            if (!geo || !geo.dept) return;
            if (!RECENSEMENT_DEPT_CODES.has(deptCode(geo.dept))) return;
            const city = geo.city || geo.dept;
            const key = type + '|' + city;
            if (seenCities.has(key)) return;
            seenCities.add(key);
            hits.push({ type, city, dept: geo.dept });
        };
        addHit('BIRT', p.birth.geo);
        addHit('MARR', p.marrGeo);
        addHit('DEAT', p.death.geo);
        if (!hits.length) return;

        results.push({ person: p, birthEst, hits });
    });
    return results;
}

export function hitLabel(type) { return HIT_LABELS[type] || type; }

// Bornes [min,max] plausibles pour l'année du recensement où rechercher cette personne : de sa
// naissance (connue ou estimée) à son décès (connu, sinon fin de période), le tout recadré sur la
// période couverte par les recensements nominatifs.
function searchDateRange(p, birthEst) {
    const min = Math.max(birthEst.year, RECENSEMENT_PERIOD_START);
    const maxCandidate = p.death.year != null ? p.death.year : RECENSEMENT_PERIOD_END;
    const max = Math.min(maxCandidate, RECENSEMENT_PERIOD_END);
    return { min, max: Math.max(min, max) };
}

// Lien pré-rempli vers la base de noms "recensement" de FranceArchives : nom/prénom/commune, plus
// genre et fenêtre de dates (naissance-décès estimées) pour affiner la recherche.
export function buildFranceArchivesUrl(p, city, birthEst) {
    const params = new URLSearchParams();
    if (p.surname) params.set('es_names', p.surname);
    if (p.given) params.set('es_forenames', p.given);
    if (city) params.set('es_locations', city);
    if (p.sex === 'M' || p.sex === 'F') params.set('es_gender', p.sex === 'M' ? 'h' : 'f');
    if (birthEst) {
        const { min, max } = searchDateRange(p, birthEst);
        params.set('es_date_min', min);
        params.set('es_date_max', max);
    }
    params.set('fulltext_facet', '');
    return `https://francearchives.gouv.fr/fr/basedenoms_recensement?${params.toString()}`;
}
