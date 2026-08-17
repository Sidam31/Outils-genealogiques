// --- TAILLE HISTORIQUE DES COMMUNES (population par recensement) ---
// Source : projet "communes_evolution" (Cassini/EHESS), distillé en un seul fichier compact
// (assets/data/communes_population.json — insee, nom, département, [[année, population], ...],
// variantes de nom éventuelles) pour permettre, sans backend, de comparer la taille de la commune de
// naissance d'un enfant à celle de ses parents (exode rural / attraction urbaine).
import { normalizePlace } from './geo.js';

let cachePromise = null;

// Index Map("dept|nom normalisé" -> {name, population:[[année,pop],...]}), chargé une seule fois.
export function loadCommunesPopulation() {
    if (!cachePromise) {
        cachePromise = fetch('assets/data/communes_population.json')
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(payload => {
                const byKey = new Map();
                (payload.communes || []).forEach(([insee, name, dept, population, altNames]) => {
                    const entry = { name, dept, population };
                    const addKey = n => {
                        const key = dept + '|' + normalizePlace(n);
                        if (!byKey.has(key)) byKey.set(key, entry); // premier gagne (collisions rares)
                    };
                    addKey(name);
                    (altNames || []).forEach(addKey);
                });
                return byKey;
            })
            .catch(err => {
                console.error('Chargement des données de population des communes échoué:', err);
                return new Map();
            });
    }
    return cachePromise;
}

// Population estimée d'une commune à une année donnée (point de recensement le plus proche), ou null
// si la commune n'est pas dans l'index ou si le point le plus proche est à plus de maxGap années
// (au-delà, l'estimation serait trop peu fiable — les relevés Cassini démarrent vers 1793).
export function estimatePopulation(byKey, townName, deptCode, year, maxGap = 75) {
    if (!byKey || !townName || !deptCode || year == null) return null;
    const entry = byKey.get(deptCode + '|' + normalizePlace(townName));
    if (!entry || !entry.population.length) return null;

    let best = null, bestGap = Infinity;
    for (const [y, p] of entry.population) {
        const gap = Math.abs(y - year);
        if (gap < bestGap) { bestGap = gap; best = p; }
    }
    return bestGap <= maxGap ? best : null;
}
