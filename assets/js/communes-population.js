// --- TAILLE HISTORIQUE DES COMMUNES (population par recensement) + LIEN SOCFACE ---
// Source : projet "communes_evolution" (Cassini/EHESS) pour la population, scripts_py/scrape_socface.py
// + build_communes_population.py pour l'identifiant SocFace (https://socface.teklia.com, registres de
// recensement nominatifs numérisés, navigables commune par commune) apparié par nom normalisé faute de
// code INSEE exposé par SocFace lui-même.
//
// Un fichier compact PAR DÉPARTEMENT (assets/data/communes_population/{dept}.json, "01".."95"/"2A"/"2B",
// même découpage que assets/data/communes_geo/{dept}.json — voir ensureCommuneGeo dans maps.js) plutôt
// qu'un seul fichier national (~14 Mo, l'ancien assets/data/communes_population.json) : seuls les
// départements réellement présents dans le GEDCOM chargé sont téléchargés. Chaque entrée est un tuple
// [insee, name, population, altNames?, socfaceTownId?] — population = [[année, habitants], ...],
// altNames/socfaceTownId omis en fin de tuple quand absents (cf. build_communes_population.py).
import { normalizePlace, deptCode } from './geo.js';

const deptFetchCache = new Map(); // code département -> Promise<tuples bruts>
const byKey = new Map(); // "dept|nom normalisé" -> {name, dept, population, socface}
const mergedDepts = new Set();

function ensureCommunePopulationDept(dept) {
    if (!deptFetchCache.has(dept)) {
        deptFetchCache.set(dept, fetch(`./assets/data/communes_population/${dept}.json`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .catch(err => {
                console.error(`Chargement des données de population du département ${dept} échoué:`, err);
                return [];
            }));
    }
    return deptFetchCache.get(dept);
}

// Recense les départements des lieux (naissance/décès/mariage/résidences) d'une liste de personnes
// (voir gedcom.js pour la forme de p.birth.geo/p.death.geo/p.marrGeo/p.resiEvents) : sert à ne charger
// que les fichiers de population réellement utiles à un GEDCOM donné plutôt que les 96 départements.
export function collectPersonDeptCodes(list) {
    const depts = new Set();
    const add = geo => { const d = geo && geo.dept && deptCode(geo.dept); if (d) depts.add(d); };
    (list || []).forEach(p => {
        add(p.birth && p.birth.geo);
        add(p.death && p.death.geo);
        add(p.marrGeo);
        (p.resiEvents || []).forEach(r => add(r.geo));
    });
    return depts;
}

// Charge (une seule fois par département, résultats cumulés) les fichiers de population des
// départements demandés et renvoie l'index partagé Map("dept|nom normalisé" -> entrée), complété au
// fil des appels successifs si de nouveaux départements sont demandés plus tard.
export async function loadCommunesPopulation(deptCodes) {
    const depts = Array.from(new Set(deptCodes || [])).filter(d => d && !mergedDepts.has(d));
    const tuplesByDept = await Promise.all(depts.map(ensureCommunePopulationDept));
    depts.forEach((dept, i) => {
        mergedDepts.add(dept);
        tuplesByDept[i].forEach(([insee, name, population, altNames, socface]) => {
            const entry = { name, dept, population, socface: socface != null ? socface : null };
            const addKey = n => {
                const key = dept + '|' + normalizePlace(n);
                if (!byKey.has(key)) byKey.set(key, entry); // premier gagne (collisions rares)
            };
            addKey(name);
            (altNames || []).forEach(addKey);
        });
    });
    return byKey;
}

function lookupCommune(map, townName, dept) {
    if (!map || !townName || !dept) return null;
    return map.get(dept + '|' + normalizePlace(townName)) || null;
}

// Population estimée d'une commune à une année donnée (point de recensement le plus proche), ou null
// si la commune n'est pas dans l'index ou si le point le plus proche est à plus de maxGap années
// (au-delà, l'estimation serait trop peu fiable — les relevés Cassini démarrent vers 1793).
export function estimatePopulation(byKeyMap, townName, dept, year, maxGap = 75) {
    if (year == null) return null;
    const entry = lookupCommune(byKeyMap, townName, dept);
    if (!entry || !entry.population.length) return null;

    let best = null, bestGap = Infinity;
    for (const [y, p] of entry.population) {
        const gap = Math.abs(y - year);
        if (gap < bestGap) { bestGap = gap; best = p; }
    }
    return bestGap <= maxGap ? best : null;
}

// Lien direct vers la page SocFace d'une commune (registres de recensement numérisés, 1836-1936),
// ou null si la commune n'est pas connue de l'index ou n'a pas été appariée à SocFace (voir
// build_communes_population.py — communes fusionnées/renommées depuis Cassini, ou département pas
// encore disponible sur SocFace).
export function getSocfaceUrl(byKeyMap, townName, dept) {
    const entry = lookupCommune(byKeyMap, townName, dept);
    if (!entry || entry.socface == null) return null;
    return `https://socface.teklia.com/town/${dept.padStart(3, '0')}/${entry.socface}`;
}
