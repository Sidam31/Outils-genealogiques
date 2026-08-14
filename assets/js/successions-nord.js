// --- SUCCESSIONS (Nord) : lien direct vers les tables des successions et absences (série 3Q) ---
// Pour chaque ancêtre décédé dans le département du Nord à une date et une commune connues, un
// lien vers le registre couvrant cette période sur le portail des Archives départementales du
// Nord (archivesdepartementales.lenord.fr). Contrairement à la base Notaires (voir notaires.js),
// ce portail n'a PAS d'index nominatif sur cette série : le lien pointe vers le ou les registres
// (des volumes de plusieurs années, à feuilleter soi-même), pas vers un acte précis — même
// principe que le mode Recensement (lien vers le bon registre, pas vers la bonne ligne).
//
// Portail propre au Nord (autre logiciel, autre URL, autre formUuid que les ~100 autres portails
// d'archives départementales) : ce module ne couvre donc que le département 59, pas la France
// entière. Le filtre "Lieux" y est un vocabulaire contrôlé (les noms de communes effectivement
// indexées dans CETTE série, en majuscules sans accents) et pas une recherche floue : une commune
// absente du dépouillement, ou indexée sous le nom de son bureau d'enregistrement plutôt que le
// sien propre (le Nord de l'ancien régime dépendait de "bureaux" couvrant plusieurs communes),
// donnera 0 résultat même si des registres existent bel et bien pour la période — vérifié
// manuellement (ARMENTIERES : 45 résultats : ECAILLON, pourtant une commune réelle du Nord : 0).
import { deptCode } from './geo.js';

const NORD_DEPT_CODE = '59';
// UUID du formulaire de recherche "Tables des successions et absences" (cote 3Q), capturé depuis
// une recherche réelle sur le portail — opaque mais stable (identifiant d'un formulaire précis).
const FORM_UUID = '6eaeac65-9e1b-43ea-bc9f-902abd458466';

const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
// "Écaillon" -> "ECAILLON" : le vocabulaire contrôlé du portail est en majuscules sans accents
// (vérifié sur "ARMENTIERES", qui ne fonctionne pas accentué).
function toPortailPlaceName(city) {
    return city.normalize('NFD').replace(DIACRITICS_RE, '').toUpperCase();
}

export function buildNordSuccessionUrl(city, year) {
    const params = new URLSearchParams();
    params.set('formUuid', FORM_UUID);
    params.set('sort', 'referencecode_asc');
    params.set('mode', 'list');
    params.set('facet_media', 'image');
    params.set('0-controlledAccessGeographicName[]', toPortailPlaceName(city));
    // Un registre couvre plusieurs années (ex. "[1848-1852]") : demander le même millésime en
    // début et fin de plage renvoie tout registre dont la période couvre CETTE année précise,
    // vérifié manuellement — pas besoin de connaître les bornes du registre à l'avance.
    if (year != null) {
        params.set('1-date_begin', year);
        params.set('1-date_end', year);
    }
    params.set('2-date', '');
    return `https://archivesdepartementales.lenord.fr/search/results?${params.toString()}`;
}

// Seul le décès donne lieu à une déclaration de succession (contrairement au notariat, un mariage
// n'en produit pas) : uniquement l'événement DEAT est considéré ici.
// opts: { ancestorScopeSet }
export function computeSuccessionLeads(list, opts) {
    opts = opts || {};
    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;
        const year = p.death?.year;
        const geo = p.death?.geo;
        if (year == null || !geo || !geo.city || !geo.dept) return;
        if (deptCode(geo.dept) !== NORD_DEPT_CODE) return;

        results.push({ person: p, year, city: geo.city, url: buildNordSuccessionUrl(geo.city, year) });
    });
    return results;
}
