// --- NOTARIAT : correspondance GEDCOM <-> base FranceGenWeb des notaires ---
// Pour chaque ancêtre marié ou décédé à une date et un lieu connus, cherche dans la base
// FranceGenWeb (https://www.francegenweb.eu/notaires/, ~40000 fiches couvrant la France
// métropolitaine et les DOM-TOM) les notaires ayant exercé dans la même commune pendant une
// période couvrant cette date : leur étude est la piste la plus probable pour retrouver un
// contrat de mariage ou un inventaire après décès.
//
// Contrairement à l'ancienne recherche Sparnatural (qui ne pouvait interroger que "cette
// personne a-t-elle produit un acte en tant que notaire", faute d'index nominatif sur les
// MINUTES elles-mêmes), la base FranceGenWeb liste directement les notaires par commune et
// période avec un lien "détail" par fiche : la correspondance se fait donc ici entièrement
// côté client, sans dépendre d'un outil de recherche tiers.
import { normalizePlace, deptCode } from './geo.js';

// Snapshot JSON régénéré par scripts_py/scrape_notaires_francegenweb.py + enrich_notaires_dates.py
// (voir ce dossier), servi comme n'importe quel autre asset statique du site.
const NOTAIRES_URL = './assets/data/notaires_francegenweb.json';

let indexPromise = null;

// Le champ "commune" de FranceGenWeb est un texte libre se terminant par le code département
// ("Verjon (Ain) 01", "Beaupont / Manziat 01", "Coligny (La Ville-sous-Charmoux) 01") : plusieurs
// communes séparées par "/" quand la charge du notaire couvrait plusieurs villages, et des
// précisions entre parenthèses (hameau, ancien nom, ou juste l'article détaché "Brusquet (le)").
// On en extrait la ou les communes normalisées comparables au geo.city du GEDCOM.
export function splitCommuneNames(rawCommune, dept) {
    if (!rawCommune || !dept) return [];
    const suffixRe = new RegExp('\\s*\\(?' + dept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)?\\s*$');
    const withoutDept = rawCommune.replace(suffixRe, '').trim();
    return withoutDept.split('/').map(part => {
        let name = part.trim();
        // "Nom (le)" / "Nom (La)" / "Nom (Les)" -> l'article se remet devant, comme dans le nom
        // réel de la commune ("Brusquet (le)" -> "Le Brusquet", "Javie (La)" -> "La Javie").
        const artMatch = name.match(/^(.*?)\s*\(\s*(le|la|les|l')\s*\)$/i);
        if (artMatch) {
            const article = artMatch[2].toLowerCase();
            const cap = article === "l'" ? "L'" : article.charAt(0).toUpperCase() + article.slice(1) + ' ';
            return `${cap}${artMatch[1].trim()}`;
        }
        // Toute autre parenthèse est une simple clarification (hameau, ancien nom...) : on ne
        // garde que le nom principal, plus fiable à comparer tel quel.
        return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
    }).filter(Boolean);
}

function buildIndex(records) {
    const index = new Map();
    records.forEach(r => {
        splitCommuneNames(r.commune, r.dept).forEach(name => {
            const key = r.dept + '|' + normalizePlace(name);
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(r);
        });
    });
    return index;
}

// Démarre le chargement dès l'import du module (le fichier pèse quelques Mo : autant lancer la
// requête pendant que la personne charge son GEDCOM plutôt qu'attendre le clic "Analyser").
// Un échec (site indisponible...) n'est pas fatal : computeNotarialActLeads reçoit alors un index
// vide et ne renvoie simplement aucune piste, plutôt que de bloquer toute l'analyse.
export function loadNotairesIndex() {
    if (!indexPromise) {
        indexPromise = fetch(NOTAIRES_URL, { cache: 'no-store' })
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(records => buildIndex(records))
            .catch(err => {
                console.error('Chargement de la base Notaires FranceGenWeb échoué:', err);
                return new Map();
            });
    }
    return indexPromise;
}

// Durée de carrière maximale plausible pour un notaire, utilisée pour borner le côté inconnu
// d'une fiche partiellement datée ("1620 -> ?") : sans ça, un notaire ayant démarré en 1620 et
// sans date de fin ressortirait comme piste pour un décès en 1980. Vérifié sur la base : parmi
// les ~44 700 fiches où date_debut ET date_fin sont connues, 95,6% ont un écart inférieur à 50 ans
// (90% < 40 ans, 97,7% < 60 ans) — 50 ans est donc une borne large mais réaliste.
const DEFAULT_MAX_CAREER_SPAN = 50;

// Un notaire "sans date du tout" (date_debut ET date_fin vides, "?", ou illisibles côté source —
// voir enrich_notaires_dates.py) a ses deux bornes à null : plutôt que d'exclure la fiche faute de
// pouvoir vérifier la période, elle est traitée comme non contraignante (mieux vaut une piste à
// vérifier soi-même qu'une fiche jamais proposée pour cette seule raison). En revanche, dès qu'une
// des deux dates est connue, elle sert d'ancrage pour borner l'autre à maxSpan années au plus.
function periodMatches(rec, year, tolerance, maxSpan) {
    maxSpan = maxSpan != null ? maxSpan : DEFAULT_MAX_CAREER_SPAN;
    const hasDebut = rec.year_debut != null;
    const hasFin = rec.year_fin != null;
    const lo = hasDebut ? rec.year_debut - tolerance
        : hasFin ? rec.year_fin - maxSpan - tolerance
        : -Infinity;
    const hi = hasFin ? rec.year_fin + tolerance
        : hasDebut ? rec.year_debut + maxSpan + tolerance
        : Infinity;
    return year >= lo && year <= hi;
}

export function notaireDetailUrl(id) {
    return `https://www.francegenweb.eu/notaires/detail.php?id=${id}`;
}

// Pour chaque personne du périmètre, cherche des notaires correspondant à son mariage et/ou son
// décès (les deux seuls événements donnant lieu à un acte notarié courant — contrat de mariage,
// inventaire après décès) : il faut une commune ET une année connues (actées, pas estimées : une
// naissance estimée à ±quelques années serait trop imprécise pour restreindre utilement la
// période notariale, contrairement au recensement où l'estimation ne sert qu'à un filtre large).
// opts: { ancestorScopeSet, tolerance, maxCareerSpan }
export function computeNotarialActLeads(list, index, opts) {
    opts = opts || {};
    const tolerance = opts.tolerance != null ? opts.tolerance : 0;
    const maxCareerSpan = opts.maxCareerSpan != null ? opts.maxCareerSpan : DEFAULT_MAX_CAREER_SPAN;
    const results = [];

    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;

        const events = [];
        const addEvent = (type, year, geo) => {
            if (year == null || !geo || !geo.city || !geo.dept) return;
            const dc = deptCode(geo.dept);
            const key = dc + '|' + normalizePlace(geo.city);
            const candidates = index.get(key) || [];
            const matches = candidates.filter(r => periodMatches(r, year, tolerance, maxCareerSpan));
            if (!matches.length) return;
            events.push({ type, year, city: geo.city, dept: dc, matches });
        };
        addEvent('mariage', p.marrYear, p.marrGeo);
        addEvent('décès', p.death?.year, p.death?.geo);

        if (!events.length) return;
        results.push({ person: p, events });
    });

    return results;
}
