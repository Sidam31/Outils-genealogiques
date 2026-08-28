// --- ANALYSE "SOCIÉTÉ" (professions, documentation, mobilité, prénoms, lignées) ---
// Complète les autres outils (Qualité, Visualisation) avec des angles absents ailleurs sur le site :
// transmission des professions, complétude documentaire, remariages, mobilité résidentielle et
// géographique, endogamie, naissances rapprochées dans une fratrie, traditions de prénoms, classement
// des prénoms par rang (1er/2e/3e) avec repérage géographique des prénoms rares, et extinction
// potentielle des lignées masculines. Les fonctions de calcul sont pures (list/map/fams en entrée,
// objets de résultats en sortie) ; le rendu HTML/D3 reste dans visualisation.html (volet "Société" de
// la page "Vue d'ensemble"), à l'exception des cartes D3 (drawRareGivenNamesMap...) qui vivent ici
// pour rester à côté de leurs données, comme les autres graphiques D3 de ce fichier.
//
// Limites liées au parser (assets/js/gedcom.js), assumées plutôt que masquées :
// - Pas de tag SOUR : "complétude documentaire" s'appuie donc sur les événements/faits renseignés,
//   pas sur des sources citées.
// - Les dates n'ont qu'une précision annuelle (getYear) : les "naissances la même année" ne sont
//   qu'un indice de naissance multiple possible, pas une confirmation jour/mois.
// DIV (divorce) et EMIG/IMMI (migrations) sont parsés par gedcom.js (voir f.div et i.events.EMIG/IMMI).

import { GEO, deptCode } from './geo.js';
import { estimatePopulation } from './communes-population.js';
import { ensureFranceGeo, showMapMessage, ensureEuropeGeo, neighborCountryLabel } from './maps.js';
import { escapeHtml } from './utils.js';

function firstGivenName(p) {
    const g = p?.given || (p?.name || '').split(' ')[0];
    return g ? g.trim().split(' ')[0].toLowerCase() : '';
}

// Faux "prénoms" occasionnellement présents dans le champ GIVN de certains fichiers (ex. "Né" ou
// "Mort" collés au prénom réel pour signaler un enfant mort-né/décédé jeune, plutôt qu'un tag GEDCOM
// dédié) : ce ne sont pas des prénoms donnés à l'état civil, donc exclus de toute l'analyse (rangs et
// prénoms rares) pour ne pas fausser les classements ni faire remonter une fausse tendance régionale.
const GIVEN_NAME_EXCLUDED = new Set(['mort', 'né']);

// Tous les prénoms d'une personne, dans l'ordre de l'état civil (ex. "Jean Baptiste Marie" -> 3
// prénoms) : p.given (tag GIVN, ou repli "Prénom /NOM/" du niveau NAME, voir gedcom.js) contient
// déjà tous les prénoms séparés par des espaces, sans le patronyme. Repli sur le premier mot de
// p.name (comme firstGivenName ci-dessus) quand given est absent — mais alors un seul prénom est
// récupérable, pas de rang 2/3.
function allGivenNames(p) {
    const raw = (p?.given && p.given.trim()) || (p?.name || '').split(' ')[0] || '';
    if (!raw) return [];
    return raw.split(/\s+/).filter(Boolean).filter(token => !GIVEN_NAME_EXCLUDED.has(token.toLowerCase()));
}

function childrenOf(person, fams, map) {
    const ids = new Set();
    (person.fams || []).forEach(fid => {
        const f = fams.get(fid);
        if (f) f.children.forEach(cid => ids.add(cid));
    });
    return Array.from(ids).map(cid => map.get(cid)).filter(Boolean);
}

// --- 1. Professions : classement + transmission père → fils ---
export function computeProfessionsStats(list, map) {
    const professions = new Map();
    let fatherSonEligible = 0, fatherSonMatches = 0;

    list.forEach(p => {
        // Une même personne peut avoir plusieurs "1 OCCU" identiques (le même métier réenregistré
        // à plusieurs actes/recensements, voir gedcom.js) : on déduplique par personne pour que ce
        // classement compte des PERSONNES exerçant une profession, pas des occurrences du tag OCCU
        // (cohérent avec computeMarriageSeasonality, qui déduplique déjà de la même façon).
        const distinctOccs = new Set((p.occupations || []).map(occ => (occ?.profession || '').trim()).filter(Boolean));
        distinctOccs.forEach(key => {
            professions.set(key, (professions.get(key) || 0) + 1);
        });

        if (p.sex === 'M' && p.occupations?.length && p.fatherId) {
            const father = map.get(p.fatherId);
            if (father?.occupations?.length) {
                fatherSonEligible++;
                const sonSet = new Set(p.occupations.map(o => o.profession.trim().toLowerCase()));
                const fatherHasMatch = father.occupations.some(o => sonSet.has(o.profession.trim().toLowerCase()));
                if (fatherHasMatch) fatherSonMatches++;
            }
        }
    });

    return {
        total: professions.size,
        top10: Array.from(professions.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10),
        fatherSonTransmission: {
            eligible: fatherSonEligible,
            matches: fatherSonMatches,
            rate: fatherSonEligible > 0 ? ((fatherSonMatches / fatherSonEligible) * 100).toFixed(1) : null
        }
    };
}

// --- 2. Complétude documentaire (à défaut de tag SOUR : dates + lieu + détail biographique) ---
export function computeDocumentationStats(list) {
    let sumScore = 0;
    const sparse = [];

    list.forEach(p => {
        const hasBirth = p.birth.year != null;
        const hasDeath = p.death.year != null;
        const hasPlace = !!(p.birth.geo?.city || p.death.geo?.city || p.marrGeo?.city);
        const hasExtra = (p.occupations?.length > 0) || (p.censusEvents?.length > 0) ||
            (p.resiEvents?.length > 0) || (p.otherEvents?.length > 0) ||
            p.events.BAPM.hasTag || p.events.BURI.hasTag;
        const score = (hasBirth ? 1 : 0) + (hasDeath ? 1 : 0) + (hasPlace ? 1 : 0) + (hasExtra ? 1 : 0);
        sumScore += score;

        if (score <= 1) {
            const missing = [];
            if (!hasBirth) missing.push('naissance');
            if (!hasDeath) missing.push('décès');
            if (!hasPlace) missing.push('lieu');
            if (!hasExtra) missing.push('détail biographique');
            sparse.push({ id: p.id, name: p.name, score, missing: missing.join(', ') });
        }
    });

    sparse.sort((a, b) => a.score - b.score);

    return {
        averageCompleteness: list.length ? ((sumScore / (list.length * 4)) * 100).toFixed(1) : 0,
        sparseCount: sparse.length,
        sparsest: sparse.slice(0, 20)
    };
}

// --- 3. Divorces (tag DIV) et remariages (plusieurs FAMS pour une même personne) ---
export function computeMaritalStabilityStats(list, fams) {
    let totalMarriages = 0, divorced = 0;
    const durations = [];

    fams.forEach(f => {
        if (!f.marr?.hasDate || f.marr.year == null) return;
        totalMarriages++;
        if (f.div?.hasDate && f.div.year != null) {
            divorced++;
            if (f.div.year > f.marr.year) durations.push(f.div.year - f.marr.year);
        }
    });

    const everMarried = list.filter(p => (p.fams || []).length > 0);
    const remarried = everMarried.filter(p => p.fams.length > 1);

    return {
        totalMarriages,
        divorced,
        divorceRate: totalMarriages > 0 ? ((divorced / totalMarriages) * 100).toFixed(1) : 0,
        averageDurationBeforeDivorce: durations.length ?
            (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : null,
        remarriage: {
            everMarriedCount: everMarried.length,
            remarriedCount: remarried.length,
            rate: everMarried.length > 0 ? ((remarried.length / everMarried.length) * 100).toFixed(1) : 0
        }
    };
}

// --- Migrations (tags EMIG/IMMI) ---
export function computeMigrationStats(list) {
    let emigrationCount = 0, immigrationCount = 0;
    const emigrationPlaces = new Map();
    const immigrationPlaces = new Map();

    list.forEach(p => {
        const emig = p.events.EMIG, immi = p.events.IMMI;
        if (emig?.hasTag) {
            emigrationCount++;
            const city = emig.geo?.city;
            if (city) emigrationPlaces.set(city, (emigrationPlaces.get(city) || 0) + 1);
        }
        if (immi?.hasTag) {
            immigrationCount++;
            const city = immi.geo?.city;
            if (city) immigrationPlaces.set(city, (immigrationPlaces.get(city) || 0) + 1);
        }
    });

    return {
        emigrationCount,
        immigrationCount,
        topEmigrationPlaces: Array.from(emigrationPlaces.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
        topImmigrationPlaces: Array.from(immigrationPlaces.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
    };
}

// --- 4. Mobilité résidentielle (tag RESI, déjà parsé mais jamais exploité ailleurs sur le site) ---
export function computeResidenceMobility(list) {
    const placeCounts = new Map();
    const perPersonCounts = [];

    list.forEach(p => {
        if (!p.resiEvents?.length) return;
        const places = new Set();
        p.resiEvents.forEach(r => {
            // cityChain garde tous les segments plus précis que le département (ex. lieu-dit + commune) ;
            // "city" seul n'en retient que le dernier (la commune), perdant le lieu-dit le cas échéant.
            const chain = r.geo?.cityChain;
            const place = chain?.length ? chain.join(', ') : r.geo?.city;
            if (place) {
                places.add(place);
                placeCounts.set(place, (placeCounts.get(place) || 0) + 1);
            }
        });
        if (places.size) perPersonCounts.push(places.size);
    });

    return {
        individualsWithResidenceData: perPersonCounts.length,
        averageResidencesPerPerson: perPersonCounts.length ?
            (perPersonCounts.reduce((a, b) => a + b, 0) / perPersonCounts.length).toFixed(1) : 0,
        topPlaces: Array.from(placeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
    };
}

// --- 5. Endogamie géographique (couple né dans la même ville) + mobilité parent → enfant ---
// communesPopIndex (optionnel, voir assets/js/communes-population.js) ajoute une comparaison de
// taille de commune (enfant vs parent) par-dessus la comparaison même-ville/département/région/pays
// déjà existante : utile pour repérer l'exode rural ou l'attraction des villes au fil des générations.
// Seuils de classement : ×1.25 ou plus = "plus grande", ×0.8 ou moins = "plus petite", entre les deux
// = taille comparable (évite de classer "plus grande/petite" un écart de quelques dizaines d'habitants
// qui ne reflète qu'une imprécision de recensement plutôt qu'un vrai changement de milieu).
const CITY_SIZE_BIGGER_RATIO = 1.25;
const CITY_SIZE_SMALLER_RATIO = 0.8;

export function computeGeographicMobility(map, fams, communesPopIndex) {
    let marriagesWithBothTowns = 0, sameTownMarriages = 0;

    fams.forEach(f => {
        if (!f.husb || !f.wife) return;
        const h = map.get(f.husb), w = map.get(f.wife);
        const hCity = h?.birth?.geo?.city, wCity = w?.birth?.geo?.city;
        if (hCity && wCity) {
            marriagesWithBothTowns++;
            if (hCity.trim().toLowerCase() === wCity.trim().toLowerCase()) sameTownMarriages++;
        }
    });

    const buckets = { sameTown: 0, sameDept: 0, sameRegion: 0, sameCountry: 0, different: 0 };
    let mobilityTotal = 0;

    const citySizeBuckets = { bigger: 0, smaller: 0, similar: 0 };
    const citySizeMoves = [];

    map.forEach(p => {
        const childGeo = p.birth?.geo;
        if (!childGeo?.city) return;
        const parent = p.fatherId ? map.get(p.fatherId) : (p.motherId ? map.get(p.motherId) : null);
        const parentGeo = parent?.birth?.geo;
        if (!parentGeo?.city) return;

        mobilityTotal++;
        const sameTown = childGeo.city.trim().toLowerCase() === parentGeo.city.trim().toLowerCase();
        if (sameTown) buckets.sameTown++;
        else if (childGeo.dept && parentGeo.dept && childGeo.dept === parentGeo.dept) buckets.sameDept++;
        else if (childGeo.region && parentGeo.region && childGeo.region === parentGeo.region) buckets.sameRegion++;
        else if (childGeo.country && parentGeo.country && childGeo.country === parentGeo.country) buckets.sameCountry++;
        else buckets.different++;

        if (!sameTown && communesPopIndex && p.birth.year != null && parent.birth?.year != null) {
            const childPop = estimatePopulation(communesPopIndex, childGeo.city, deptCode(childGeo.dept), p.birth.year);
            const parentPop = estimatePopulation(communesPopIndex, parentGeo.city, deptCode(parentGeo.dept), parent.birth.year);
            if (childPop != null && parentPop != null && parentPop > 0) {
                const ratio = childPop / parentPop;
                const bucket = ratio >= CITY_SIZE_BIGGER_RATIO ? 'bigger' : (ratio <= CITY_SIZE_SMALLER_RATIO ? 'smaller' : 'similar');
                citySizeBuckets[bucket]++;
                citySizeMoves.push({
                    name: p.name, childPlace: childGeo.city, childPop, childYear: p.birth.year,
                    parentName: parent.name, parentPlace: parentGeo.city, parentPop, parentYear: parent.birth.year,
                    ratio
                });
            }
        }
    });

    const citySizeTotal = citySizeBuckets.bigger + citySizeBuckets.smaller + citySizeBuckets.similar;
    // Tri par écart le plus marquant, dans un sens comme dans l'autre (ratio ou son inverse, le plus
    // grand des deux) : place aussi bien les plus fortes montées en ville que les plus forts exodes.
    citySizeMoves.sort((a, b) => Math.max(b.ratio, 1 / b.ratio) - Math.max(a.ratio, 1 / a.ratio));

    return {
        endogamy: {
            sampleSize: marriagesWithBothTowns,
            sameTownMarriages,
            rate: marriagesWithBothTowns > 0 ? ((sameTownMarriages / marriagesWithBothTowns) * 100).toFixed(1) : 0
        },
        parentChildMobility: { total: mobilityTotal, buckets },
        citySize: {
            total: citySizeTotal,
            buckets: citySizeBuckets,
            percentages: {
                bigger: citySizeTotal > 0 ? ((citySizeBuckets.bigger / citySizeTotal) * 100).toFixed(1) : 0,
                smaller: citySizeTotal > 0 ? ((citySizeBuckets.smaller / citySizeTotal) * 100).toFixed(1) : 0,
                similar: citySizeTotal > 0 ? ((citySizeBuckets.similar / citySizeTotal) * 100).toFixed(1) : 0
            },
            topMoves: citySizeMoves.slice(0, 10)
        }
    };
}

// --- 6. Naissances la même année dans une fratrie (indice de naissance multiple : précision annuelle
//    seulement, voir note en tête de fichier) ---
export function computeSameYearSiblings(map, fams) {
    const sets = [];

    fams.forEach(f => {
        const byYear = new Map();
        (f.children || []).forEach(cid => {
            const c = map.get(cid);
            if (!c || c.birth.year == null || c.birth.approx) return;
            if (!byYear.has(c.birth.year)) byYear.set(c.birth.year, []);
            byYear.get(c.birth.year).push(c);
        });
        byYear.forEach((children, year) => {
            if (children.length >= 2) {
                sets.push({
                    year,
                    count: children.length,
                    names: children.map(c => c.name),
                    father: f.husb ? (map.get(f.husb)?.name || 'Inconnu') : 'Inconnu',
                    mother: f.wife ? (map.get(f.wife)?.name || 'Inconnue') : 'Inconnue'
                });
            }
        });
    });

    sets.sort((a, b) => b.count - a.count);
    return { totalSets: sets.length, sets: sets.slice(0, 10) };
}

// --- 7. Traditions de transmission des prénoms (enfant nommé d'après un grand-parent de même sexe) ---
export function computeNamingPatterns(map) {
    let paternalGfEligible = 0, paternalGfMatches = 0;
    let maternalGmEligible = 0, maternalGmMatches = 0;
    let anyEligible = 0, anyMatches = 0;

    map.forEach(p => {
        const childName = firstGivenName(p);
        if (!childName) return;

        const father = p.fatherId ? map.get(p.fatherId) : null;
        const mother = p.motherId ? map.get(p.motherId) : null;
        const pgf = father?.fatherId ? map.get(father.fatherId) : null;
        const pgm = father?.motherId ? map.get(father.motherId) : null;
        const mgf = mother?.fatherId ? map.get(mother.fatherId) : null;
        const mgm = mother?.motherId ? map.get(mother.motherId) : null;

        if (p.sex === 'M' && pgf) {
            const n = firstGivenName(pgf);
            if (n) { paternalGfEligible++; if (n === childName) paternalGfMatches++; }
        }
        if (p.sex === 'F' && mgm) {
            const n = firstGivenName(mgm);
            if (n) { maternalGmEligible++; if (n === childName) maternalGmMatches++; }
        }

        const sameGenderGrandparents = [pgf, pgm, mgf, mgm].filter(gp => gp && gp.sex === p.sex);
        if (sameGenderGrandparents.length) {
            anyEligible++;
            if (sameGenderGrandparents.some(gp => firstGivenName(gp) === childName)) anyMatches++;
        }
    });

    const rate = (matches, eligible) => eligible > 0 ? ((matches / eligible) * 100).toFixed(1) : null;
    return {
        paternalGrandfather: { eligible: paternalGfEligible, matches: paternalGfMatches, rate: rate(paternalGfMatches, paternalGfEligible) },
        maternalGrandmother: { eligible: maternalGmEligible, matches: maternalGmMatches, rate: rate(maternalGmMatches, maternalGmEligible) },
        anySameGenderGrandparent: { eligible: anyEligible, matches: anyMatches, rate: rate(anyMatches, anyEligible) }
    };
}

// --- 7bis. Prénoms donnés (1er, 2e, 3e) : classement par rang (coloré par profil de sexe des
//    porteurs) + repérage des prénoms rares et de leur répartition géographique (commune de
//    naissance), pour repérer d'éventuelles tendances régionales dans le choix des prénoms peu
//    courants. Un prénom est classé "rare" sur son total d'occurrences TOUS RANGS confondus (ex. un
//    prénom donné une fois en 1er prénom et une fois en 2e compte pour 2) : opts.rareMaxCount
//    (défaut 9, soit "moins de 10 fois") fixe le seuil. Volontairement large plutôt que très strict :
//    plus le vivier de prénoms rares est large, plus il y a de chances d'y trouver un regroupement
//    géographique visible — mais avec un tel vivier ("beaucoup" de prénoms rares dans un fichier de
//    plusieurs centaines d'individus), colorer chaque prénom rare rendrait la carte illisible. On ne
//    met donc en couleur que les GIVEN_NAME_HIGHLIGHT_COUNT prénoms rares dont les communes de
//    naissance sont le plus resserrées géographiquement (plus petite distance moyenne entre elles) —
//    l'indice le plus direct d'une possible tendance régionale — tous les autres restant en gris sur
//    la carte (voir drawRareGivenNamesMap). La carte dépend de coordonnées de commune déjà résolues
//    (voir enrichMissingCoords, assets/js/maps.js) : tant qu'elles ne le sont pas,
//    geolocatedRareOccurrences reste à 0 et mapReady à false.
const GIVEN_NAME_MAX_RANK = 3;
const GIVEN_NAME_RANK_LABELS = ['1er prénom', '2e prénom', '3e prénom'];
const GIVEN_NAME_MIN_SAMPLE_FOR_MAP = 15;
export const GIVEN_NAME_HIGHLIGHT_COUNT = 20;
// Seuils de classement du "profil de sexe" d'un prénom à un rang donné : au moins 75% de porteurs
// d'un même sexe pour le classer "M"/"F", entre les deux c'est "mixed" (prénom réellement partagé,
// ex. beaucoup de "Marie" en 2e/3e prénom masculin dans la tradition catholique). "unknown" ne
// signifie pas "mixte" mais "aucune personne avec ce prénom n'a de sexe renseigné dans le fichier".
const SEX_PROFILE_MALE_RATIO = 0.75;
const SEX_PROFILE_FEMALE_RATIO = 0.25;
export const SEX_PROFILE_COLORS = { M: '#3498db', F: '#e91e8c', mixed: '#9b59b6', unknown: '#95a5a6' };
export const SEX_PROFILE_LABELS = { M: 'Masculin', F: 'Féminin', mixed: 'Mixte (les deux sexes)', unknown: 'Sexe inconnu' };
// Palette pour les GIVEN_NAME_HIGHLIGHT_COUNT prénoms rares les plus regroupés géographiquement (une
// couleur chacun, prise dans l'ordre) : 15 teintes "Flat UI" bien distinguables entre elles, en évitant
// volontairement le bleu/rose/violet/gris déjà utilisés ci-dessus pour le profil de sexe.
export const RARE_GIVEN_NAME_HIGHLIGHT_COLORS = [
    '#1abc9c', '#e67e22', '#c0392b', '#2980b9', '#f1c40f',
    '#27ae60', '#d35400', '#8e44ad', '#e74c3c', '#2c3e50',
    '#f39c12', '#16a085', '#34495e', '#7f8c8d', '#2ecc71'
];
export const RARE_GIVEN_NAME_OTHER_COLOR = '#95a5a6';

function sexProfileOf(male, female) {
    const total = male + female;
    if (total === 0) return 'unknown';
    const ratio = male / total;
    if (ratio >= SEX_PROFILE_MALE_RATIO) return 'M';
    if (ratio <= SEX_PROFILE_FEMALE_RATIO) return 'F';
    return 'mixed';
}

// Distance orthodromique (km) entre deux points [lat,lon] — utilisée uniquement pour comparer entre
// eux les prénoms rares (lequel a ses communes de naissance les plus resserrées), pas pour un usage
// cartographique précis : la Terre y est approximée par une sphère (rayon moyen 6371 km), suffisant
// à cette échelle de comparaison relative.
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distance moyenne PONDÉRÉE entre toutes les NAISSANCES (pas seulement entre communes distinctes,
// chacune comptant pour 1 quel que soit son nombre de porteurs) d'un même prénom : chaque point pèse
// pour son nombre de porteurs (weight). Sans cette pondération, un prénom donné 9 fois dans une seule
// commune + 1 fois loin de là paraissait tout aussi "dispersé" qu'un prénom donné une seule fois dans
// chacune de deux communes distantes (les deux ne comptent que 2 communes distinctes) — alors que le
// premier cas est, dans les faits, massivement concentré à un seul endroit. Formule : moyenne sur
// toutes les paires ORDONNÉES de porteurs (y compris les paires au sein d'une même commune, distance
// 0), soit 2·Σ(w_i·w_j·d(i,j)) / (W·(W-1)) pour i<j, W = somme des poids. Un seul point, ou un poids
// total < 2 (ne devrait pas arriver ici : geolocatedCount >= 2 est déjà filtré avant l'appel), donne
// 0 km — le regroupement le plus fort possible.
function averagePairwiseDistanceKm(points) {
    const totalWeight = points.reduce((sum, p) => sum + (p.weight || 1), 0);
    if (points.length < 2 || totalWeight < 2) return 0;
    let weightedSum = 0;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const w = (points[i].weight || 1) * (points[j].weight || 1);
            weightedSum += w * haversineKm(points[i].lat, points[i].lon, points[j].lat, points[j].lon);
        }
    }
    return (2 * weightedSum) / (totalWeight * (totalWeight - 1));
}

export function computeGivenNameStats(list, opts = {}) {
    const rareMaxCount = opts.rareMaxCount ?? 9;
    // Filtre optionnel appliqué UNIQUEMENT à l'analyse des prénoms rares (rareté, carte, liste) : les
    // classements par rang (ranks, ci-dessous) restent, eux, toujours calculés sur toute la population
    // — ils affichent déjà le sexe par couleur (voir sexProfileOf), filtrer les priverait justement de
    // l'intérêt de voir les deux sexes se comparer. "Filles"/"Garçons" ne réduit donc pas la liste des
    // porteurs d'un prénom déjà jugé rare sur l'ensemble : la rareté elle-même est recalculée sur le
    // seul sous-groupe choisi (ex. un prénom donné 3 fois à des filles et 7 fois à des garçons peut être
    // "rare" côté filles mais pas côté garçons, selon rareMaxCount).
    const sexFilter = (opts.sexFilter === 'M' || opts.sexFilter === 'F') ? opts.sexFilter : null;

    const rankCounts = Array.from({ length: GIVEN_NAME_MAX_RANK }, () => new Map());
    const occurrences = []; // { key, label, rank, person }, une entrée par prénom par personne

    list.forEach(p => {
        const sex = (p.sex === 'M' || p.sex === 'F') ? p.sex : null;
        allGivenNames(p).slice(0, GIVEN_NAME_MAX_RANK).forEach((raw, idx) => {
            const key = raw.toLowerCase();
            const label = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();

            if (!rankCounts[idx].has(key)) rankCounts[idx].set(key, { label, count: 0, male: 0, female: 0 });
            const rankEntry = rankCounts[idx].get(key);
            rankEntry.count++;
            if (sex === 'M') rankEntry.male++; else if (sex === 'F') rankEntry.female++;

            occurrences.push({ key, label, rank: idx + 1, person: p });
        });
    });

    const ranks = rankCounts.map((counts, idx) => {
        const sorted = Array.from(counts.values())
            .map(d => ({ ...d, sexProfile: sexProfileOf(d.male, d.female) }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
        return {
            rank: idx + 1,
            label: GIVEN_NAME_RANK_LABELS[idx],
            distinctCount: sorted.length,
            total: sorted.reduce((sum, d) => sum + d.count, 0),
            top: sorted.slice(0, 15)
        };
    });

    // À partir d'ici, tout se calcule sur le sous-groupe sexFilter (ou la population entière si non
    // renseigné) : c'est sur CE périmètre qu'un prénom est jugé rare, géolocalisé, et retenu pour la carte.
    const scopedOccurrences = sexFilter ? occurrences.filter(o => o.person.sex === sexFilter) : occurrences;
    const globalCounts = new Map(); // prénom (minuscule) -> { label, count } tous rangs confondus, sur le périmètre
    scopedOccurrences.forEach(o => {
        if (!globalCounts.has(o.key)) globalCounts.set(o.key, { label: o.label, count: 0 });
        globalCounts.get(o.key).count++;
    });

    const rareKeys = new Set(Array.from(globalCounts.entries()).filter(([, v]) => v.count <= rareMaxCount).map(([k]) => k));

    // Un point par (prénom, commune géolocalisée) : regroupe les occurrences du même prénom rare nées
    // au même endroit, plutôt qu'un point par personne (illisible dès que plusieurs porteurs partagent
    // la même commune de naissance, ex. fratrie).
    const pointMap = new Map();
    let totalRareOccurrences = 0, geolocatedRareOccurrences = 0;
    scopedOccurrences.forEach(o => {
        if (!rareKeys.has(o.key)) return;
        totalRareOccurrences++;
        const geo = o.person.birth?.geo;
        if (!geo || geo.lat == null || geo.lon == null) return;
        geolocatedRareOccurrences++;
        const pointKey = `${o.key}|${geo.lat.toFixed(3)}|${geo.lon.toFixed(3)}`;
        if (!pointMap.has(pointKey)) {
            pointMap.set(pointKey, { name: o.key, label: o.label, lat: geo.lat, lon: geo.lon, city: geo.city || null, dept: geo.dept || null, count: 0, items: [] });
        }
        const pt = pointMap.get(pointKey);
        pt.count++;
        if (pt.items.length < 20) pt.items.push({ personName: o.person.name, rank: o.rank, year: o.person.birth?.year ?? null });
    });

    const rarePoints = Array.from(pointMap.values()).sort((a, b) => b.count - a.count);

    const rareNameSummaries = Array.from(rareKeys).map(key => {
        const info = globalCounts.get(key);
        const pts = rarePoints.filter(pt => pt.name === key);
        const depts = new Set(pts.map(pt => pt.dept).filter(Boolean));
        return {
            key,
            name: info.label,
            count: info.count,
            geolocatedCount: pts.reduce((sum, pt) => sum + pt.count, 0),
            distinctCommunes: pts.length,
            distinctDepts: depts.size
        };
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));

    // Prénoms rares retenus pour la carte : parmi ceux ayant au moins 2 naissances géolocalisées (sans
    // quoi "regroupement géographique" n'a pas de sens — un seul point n'est jamais informatif), les
    // GIVEN_NAME_HIGHLIGHT_COUNT dont la distance moyenne entre communes de naissance est la plus
    // faible (à effectif égal, on privilégie celui qui a le plus de porteurs, échantillon plus solide).
    const highlightedNames = rareNameSummaries
        .filter(s => s.geolocatedCount >= 2)
        .map(s => ({ ...s, spreadKm: averagePairwiseDistanceKm(rarePoints.filter(pt => pt.name === s.key).map(pt => ({ lat: pt.lat, lon: pt.lon, weight: pt.count }))) }))
        .sort((a, b) => a.spreadKm - b.spreadKm || b.count - a.count)
        .slice(0, GIVEN_NAME_HIGHLIGHT_COUNT);

    return {
        ranks,
        rareMaxCount,
        sexFilter,
        rareNamesCount: rareKeys.size,
        totalRareOccurrences,
        geolocatedRareOccurrences,
        rarePoints,
        rareNameSummaries,
        highlightedNames,
        mapReady: geolocatedRareOccurrences >= GIVEN_NAME_MIN_SAMPLE_FOR_MAP
    };
}

// --- 8. Extinction potentielle des lignées masculines : hommes décédés, sans fils connu, alors que
//    la lignée a eu des enfants. Basé uniquement sur les données saisies (voir note dans visualisation.html).
export function computeSurnameExtinction(map, fams) {
    const bySurname = new Map();
    map.forEach(p => {
        if (p.sex !== 'M' || !p.surname) return;
        const key = p.surname.trim();
        if (!key) return;
        if (!bySurname.has(key)) bySurname.set(key, []);
        bySurname.get(key).push(p);
    });

    const atRisk = [];
    bySurname.forEach((men, surname) => {
        const menWithChildren = men.filter(m => childrenOf(m, fams, map).length > 0);
        const menWithSons = men.filter(m => childrenOf(m, fams, map).some(c => c.sex === 'M'));
        const menDeceasedWithoutSon = men.filter(m =>
            m.death?.year != null && !childrenOf(m, fams, map).some(c => c.sex === 'M')
        );

        if (men.length > 0 && menWithSons.length === 0 && menWithChildren.length > 0) {
            atRisk.push({
                surname,
                menRecorded: men.length,
                menWithChildren: menWithChildren.length,
                menDeceasedWithoutSon: menDeceasedWithoutSon.length
            });
        }
    });

    atRisk.sort((a, b) => b.menRecorded - a.menRecorded);
    return { totalMaleSurnames: bySurname.size, atRiskCount: atRisk.length, atRiskSurnames: atRisk.slice(0, 15) };
}

// --- 9. Saisonnalité des mariages par profession : le mois de mariage (tag MARR/DATE — jour+mois
//    disponible seulement pour une date complète et certaine, voir gedcom.js strictFullDate) croisé
//    avec les professions (p.occupations) des personnes qui se marient. Une même personne peut
//    apparaître dans plusieurs FAMS (remariage) : chaque mariage daté compte séparément pour elle.
//    minYear/maxYear (optionnels) restreignent l'analyse à une période, pour voir si un profil
//    saisonnier se déplace au fil du temps plutôt que de n'avoir qu'une moyenne sur tout le fichier.
export const SEASONALITY_MONTH_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const SEASONALITY_MONTH_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

// Une personne peut avoir plusieurs métiers successifs, chacun avec sa propre période (voir
// parseOccupationValue dans gedcom.js, ex. "Valet de meunier (1819-1820), Meunier (1838)") : à une
// année de mariage donnée, on ne veut retenir que le(s) métier(s) réellement exercé(s) cette
// année-là, pas tous les métiers de toute une vie (sinon un même mariage "compte" à la fois pour le
// métier de jeunesse et celui de fin de vie). Si aucun métier daté ne couvre cette année précise, on
// se rabat sur les métiers non datés de la personne (cas le plus courant : un seul "1 OCCU" sans
// année) plutôt que de perdre la personne pour cette analyse.
function professionsAtYear(occupations, year) {
    const dated = occupations.filter(o => o.yearStart != null);
    const matching = dated.filter(o => year >= o.yearStart && year <= (o.yearEnd ?? o.yearStart));
    let selected;
    if (matching.length > 0) selected = matching;
    else if (dated.length > 0) selected = occupations.filter(o => o.yearStart == null);
    else selected = occupations;

    const seen = new Set();
    const result = [];
    selected.forEach(o => {
        const key = (o.profession || '').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        result.push(key);
    });
    return result;
}

export function computeMarriageSeasonality(list, fams, opts = {}) {
    const topN = opts.topN || 8;
    const minYear = opts.minYear ?? null;
    const maxYear = opts.maxYear ?? null;
    const minSample = opts.minSample || 5;

    const profTotals = new Map();
    const profMonths = new Map();
    const overallByMonth = new Array(12).fill(0);
    let overallTotal = 0;

    list.forEach(p => {
        if (!p.occupations?.length || !p.fams?.length) return;

        p.fams.forEach(fid => {
            const f = fams.get(fid);
            if (!f?.marr?.hasDate || f.marr.month == null) return;
            if (minYear != null && (f.marr.year == null || f.marr.year < minYear)) return;
            if (maxYear != null && (f.marr.year == null || f.marr.year > maxYear)) return;

            const profs = professionsAtYear(p.occupations, f.marr.year);
            if (!profs.length) return;

            const month = f.marr.month;
            overallByMonth[month]++;
            overallTotal++;
            profs.forEach(prof => {
                if (!profMonths.has(prof)) { profMonths.set(prof, new Array(12).fill(0)); profTotals.set(prof, 0); }
                profMonths.get(prof)[month]++;
                profTotals.set(prof, profTotals.get(prof) + 1);
            });
        });
    });

    const toRow = (label, total, counts) => ({
        label, total,
        byMonth: counts.map((count, month) => ({
            month, label: SEASONALITY_MONTH_LABELS[month], shortLabel: SEASONALITY_MONTH_SHORT[month], count,
            pct: total > 0 ? +(count / total * 100).toFixed(1) : 0
        }))
    });

    const professions = Array.from(profTotals.entries())
        .filter(([, total]) => total >= minSample)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([prof, total]) => toRow(prof, total, profMonths.get(prof)));

    const overall = toRow('Ensemble', overallTotal, overallByMonth);

    // Repère le plus grand écart (profession, mois) par rapport à la moyenne générale de ce mois-là :
    // un exemple concret à mettre en avant sans imposer d'hypothèse a priori (hiver, été...).
    let mostSkewed = null, maxDelta = -1;
    professions.forEach(row => {
        row.byMonth.forEach((m, i) => {
            const delta = m.pct - overall.byMonth[i].pct;
            if (Math.abs(delta) > maxDelta) {
                maxDelta = Math.abs(delta);
                mostSkewed = { profession: row.label, month: SEASONALITY_MONTH_LABELS[i], profPct: m.pct, overallPct: overall.byMonth[i].pct, total: row.total };
            }
        });
    });

    return { monthLabels: SEASONALITY_MONTH_LABELS, overall, professions, overallTotal, mostSkewed, minSample };
}

export function computeSocietyStats(list, map, fams, communesPopIndex) {
    return {
        professions: computeProfessionsStats(list, map),
        documentation: computeDocumentationStats(list),
        maritalStability: computeMaritalStabilityStats(list, fams),
        migration: computeMigrationStats(list),
        residenceMobility: computeResidenceMobility(list),
        geographicMobility: computeGeographicMobility(map, fams, communesPopIndex),
        sameYearSiblings: computeSameYearSiblings(map, fams),
        namingPatterns: computeNamingPatterns(map),
        surnameExtinction: computeSurnameExtinction(map, fams)
    };
}

// --- Graphiques D3 (même idiome visuel que assets/js/maps.js / quality.js) ---

// Barres horizontales label/count, même idiome visuel que les autres graphiques du site (maps.js).
export function drawRankedBarChart(containerId, data, opts = {}) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();
    if (!data.length) {
        container.append('div').attr('class', 'map-placeholder').text(opts.emptyMessage || 'Aucune donnée disponible.');
        return;
    }

    // opts.legendItems (optionnel) : petite légende empilée verticalement en haut à gauche, pour un
    // encodage couleur qui ne se lit pas sur l'axe (ex. couleur = sexe des porteurs d'un prénom, voir
    // renderGivenNames dans visualisation.html) — même idiome que la légende de drawDepartmentMap
    // (maps.js), juste positionnée en haut plutôt qu'en bas puisque les barres, elles, partent du haut.
    const legendItems = opts.legendItems || null;
    const legendRowHeight = 14;
    const legendHeight = legendItems && legendItems.length ? legendItems.length * legendRowHeight + 8 : 0;

    const width = container.node().clientWidth || 500;
    const barHeight = 22;
    const margin = { top: 10 + legendHeight, right: 44, bottom: 10, left: 150 };
    const height = margin.top + margin.bottom + data.length * barHeight;
    // viewBox + width 100% (plutôt qu'un attribut width fixe) : le graphe est souvent dessiné pendant
    // que son onglet est encore caché (clientWidth = 0, d'où le repli sur 500), ce qui produirait un
    // SVG figé à 500px débordant de la boîte une fois l'onglet affiché dans un panneau plus étroit.
    const svg = container.append('svg').attr('viewBox', `0 0 ${width} ${height}`)
        .style('width', '100%').style('height', 'auto').style('display', 'block');

    const maxCount = d3.max(data, d => d.count) || 1;
    const x = d3.scaleLinear().domain([0, maxCount]).nice().range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(data.map(d => d.label)).range([margin.top, height - margin.bottom]).padding(0.22);
    // colorFor (optionnel) prime sur color/colorHover fixes : permet une couleur par barre (ex. par
    // sexe) plutôt qu'une seule couleur pour tout le graphique. Le survol s'assombrit dynamiquement
    // (d3.color(...).darker) plutôt que via une seconde couleur fixe par barre, sinon opts.colorFor
    // devrait fournir deux fonctions au lieu d'une pour un simple effet de survol.
    const staticColor = opts.color || '#3498db';
    const colorFor = typeof opts.colorFor === 'function' ? opts.colorFor : (() => staticColor);

    if (legendItems && legendItems.length) {
        const legendG = svg.append('g').attr('transform', 'translate(6, 10)');
        legendItems.forEach((item, i) => {
            legendG.append('circle').attr('cx', 5).attr('cy', i * legendRowHeight).attr('r', 4).attr('fill', item.color);
            legendG.append('text').attr('x', 14).attr('y', i * legendRowHeight + 3).style('font-size', '9.5px').style('fill', '#333').text(item.label);
        });
    }

    const tooltip = document.getElementById('tooltip');
    svg.selectAll('rect.bar').data(data).join('rect')
        .attr('class', 'bar')
        .attr('x', x(0)).attr('y', d => y(d.label)).attr('width', d => x(d.count) - x(0)).attr('height', y.bandwidth())
        .attr('fill', d => colorFor(d))
        .on('mouseover', function(e, d) {
            d3.select(this).attr('fill', d3.color(colorFor(d)).darker(0.6));
            if (tooltip) {
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${d.label}</strong><div class="tt-row"><span>${opts.countLabel || 'Occurrences'}</span><span>${d.count}</span></div>${opts.tooltipExtra ? opts.tooltipExtra(d) : ''}`;
            }
        })
        .on('mousemove', e => {
            if (!tooltip) return;
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function(e, d) {
            d3.select(this).attr('fill', colorFor(d));
            if (tooltip) tooltip.style.opacity = 0;
        });

    svg.selectAll('text.bar-label').data(data).join('text')
        .attr('class', 'bar-label')
        .attr('x', margin.left - 8).attr('y', d => y(d.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .attr('text-anchor', 'end').style('font-size', '11px')
        .text(d => d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label)
        .append('title').text(d => d.label);

    svg.selectAll('text.bar-count').data(data).join('text')
        .attr('class', 'bar-count')
        .attr('x', d => x(d.count) + 5).attr('y', d => y(d.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .style('font-size', '10px').style('fill', '#555')
        .text(d => d.count);
}

// Barres verticales par catégorie, identique dans l'esprit à drawIssuesBarChart (quality.js).
export function drawCategoryBarChart(containerId, data) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();
    if (!data.length || !data.some(d => d.count > 0)) {
        container.append('div').attr('class', 'map-placeholder').text('Aucune donnée disponible.');
        return;
    }

    const width = container.node().clientWidth || 400, height = 240;
    const margin = { top: 15, right: 15, bottom: 55, left: 40 };
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const x = d3.scaleBand().domain(data.map(d => d.label)).range([margin.left, width - margin.right]).padding(0.3);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count) || 1]).nice().range([height - margin.bottom, margin.top]);

    svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x))
        .selectAll('text').style('font-size', '9px').attr('transform', 'rotate(-20)').style('text-anchor', 'end');
    svg.append('g').attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('d')))
        .selectAll('text').style('font-size', '10px');

    svg.selectAll('rect.bar').data(data).join('rect').attr('class', 'bar')
        .attr('x', d => x(d.label)).attr('y', d => y(d.count))
        .attr('width', x.bandwidth()).attr('height', d => height - margin.bottom - y(d.count))
        .attr('fill', '#e67e22');

    svg.selectAll('text.val').data(data).join('text').attr('class', 'val')
        .attr('x', d => x(d.label) + x.bandwidth() / 2).attr('y', d => y(d.count) - 5)
        .attr('text-anchor', 'middle').style('font-size', '11px').style('font-weight', 'bold')
        .text(d => d.count);
}

// Heatmap profession × mois de mariage (voir computeMarriageSeasonality) : une ligne "Ensemble" (tous
// mariages datés confondus) sert de référence au-dessus des lignes par profession, triées par nombre
// de mariages décroissant. Chaque cellule encode, en dégradé séquentiel (une seule teinte, clair→foncé,
// même idiome que le fond de carte de maps.js), la part des mariages de CETTE ligne tombant dans ce
// mois (pourcentage, pas effectif brut) : ça permet de comparer la forme de la saisonnalité entre des
// professions dont les effectifs totaux diffèrent beaucoup. L'effectif brut reste visible au survol.
export function drawSeasonalityHeatmap(containerId, data, opts = {}) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();

    const rows = data.overall.total > 0 ? [data.overall, ...data.professions] : [];
    if (!rows.length) {
        container.append('div').attr('class', 'map-placeholder')
            .text(opts.emptyMessage || 'Pas assez de données (profession + date de mariage complète — jour, mois, année — requises).');
        return;
    }

    const width = container.node().clientWidth || 600;
    const cellHeight = 24;
    const totalColWidth = 40;
    const margin = { top: 26, right: 140, bottom: 6, left: 170 };
    const height = margin.top + margin.bottom + rows.length * cellHeight;
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const months = d3.range(12);
    const gridRight = width - margin.right;
    const x = d3.scaleBand().domain(months).range([margin.left, gridRight]).padding(0.08);
    const y = d3.scaleBand().domain(rows.map(r => r.label)).range([margin.top, height - margin.bottom]).padding(0.08);
    const maxPct = d3.max(rows, r => d3.max(r.byMonth, m => m.pct)) || 1;
    const color = d3.scaleSequential(d3.interpolateBlues).domain([0, maxPct]);
    // Colonne "Total" juste après Décembre : donne le nombre de mariages derrière chaque ligne, pour
    // juger si un pourcentage repose sur un échantillon solide ou sur une poignée de cas.
    const totalColCenter = gridRight + 14 + totalColWidth / 2;
    const legendX = gridRight + 14 + totalColWidth + 18;

    svg.selectAll('text.month-label').data(months).join('text').attr('class', 'month-label')
        .attr('x', m => x(m) + x.bandwidth() / 2).attr('y', margin.top - 8)
        .attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#555')
        .text(m => SEASONALITY_MONTH_SHORT[m]);

    svg.append('text').attr('class', 'month-label')
        .attr('x', totalColCenter).attr('y', margin.top - 8)
        .attr('text-anchor', 'middle').style('font-size', '10px').style('font-weight', 700).style('fill', '#555')
        .text('Total');

    svg.selectAll('text.row-label').data(rows).join('text').attr('class', 'row-label')
        .attr('x', margin.left - 8).attr('y', r => y(r.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .attr('text-anchor', 'end').style('font-size', '11px')
        .style('font-weight', r => r.label === 'Ensemble' ? 700 : 400)
        .text(r => r.label.length > 24 ? r.label.slice(0, 22) + '…' : r.label)
        .append('title').text(r => r.label);

    svg.selectAll('text.row-total').data(rows).join('text').attr('class', 'row-total')
        .attr('x', totalColCenter).attr('y', r => y(r.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .attr('text-anchor', 'middle').style('font-size', '11px').style('fill', '#333')
        .style('font-weight', r => r.label === 'Ensemble' ? 700 : 400)
        .text(r => r.total);

    // Séparateur sous la ligne "Ensemble" pour la distinguer visuellement des professions (grille +
    // colonne Total, la légende reste à part).
    svg.append('line')
        .attr('x1', margin.left - 4).attr('x2', gridRight + 14 + totalColWidth)
        .attr('y1', y(rows[0].label) + y.bandwidth() + y.step() * 0.04)
        .attr('y2', y(rows[0].label) + y.bandwidth() + y.step() * 0.04)
        .attr('stroke', '#bbb').attr('stroke-width', 1);

    const tooltip = document.getElementById('tooltip');
    const rowGroups = svg.selectAll('g.seas-row').data(rows).join('g').attr('class', 'seas-row');
    rowGroups.selectAll('rect').data(r => r.byMonth.map(m => ({ ...m, rowLabel: r.label, rowTotal: r.total }))).join('rect')
        .attr('x', d => x(d.month)).attr('y', d => y(d.rowLabel))
        .attr('width', x.bandwidth()).attr('height', y.bandwidth())
        .attr('fill', d => d.count > 0 ? color(d.pct) : '#f4f6f7')
        .attr('stroke', '#fff').attr('stroke-width', 1)
        .on('mouseover', function(e, d) {
            d3.select(this).attr('stroke', '#2c3e50').attr('stroke-width', 1.5);
            if (tooltip) {
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${d.rowLabel} — ${d.label}</strong>
                    <div class="tt-row"><span>Mariages ce mois</span><span>${d.count}</span></div>
                    <div class="tt-row"><span>Part sur l'année</span><span>${d.pct}%</span></div>
                    <div class="tt-row"><span>Total « ${d.rowLabel} »</span><span>${d.rowTotal}</span></div>`;
            }
        })
        .on('mousemove', e => {
            if (!tooltip) return;
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1);
            if (tooltip) tooltip.style.opacity = 0;
        });

    // Légende séquentielle (dégradé + repères min/max) : requise pour une heatmap, où la couleur porte
    // l'information (contrairement aux barres/lignes du site, où l'axe suffit).
    const legendY = margin.top, legendW = 14, legendH = Math.min(90, height - margin.top - margin.bottom);
    const gradientId = `seas-grad-${containerId}`;
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient').attr('id', gradientId).attr('x1', '0').attr('x2', '0').attr('y1', '1').attr('y2', '0');
    d3.range(0, 1.01, 0.1).forEach(t => gradient.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', color(t * maxPct)));
    svg.append('rect').attr('x', legendX).attr('y', legendY).attr('width', legendW).attr('height', legendH)
        .attr('fill', `url(#${gradientId})`).attr('stroke', '#ccc').attr('stroke-width', 0.5);
    svg.append('text').attr('x', legendX + legendW + 5).attr('y', legendY + 8).style('font-size', '9px').style('fill', '#555').text(`${maxPct.toFixed(0)}%`);
    svg.append('text').attr('x', legendX + legendW + 5).attr('y', legendY + legendH).style('font-size', '9px').style('fill', '#555').text('0%');
}

// Carte de France (points = communes de naissance) pour les prénoms rares repérés par
// computeGivenNameStats : mêmes contours et même projection que drawFranceMap (assets/js/maps.js),
// pour rester visuellement cohérent avec les autres cartes du site — pays voisins compris (Belgique,
// Suisse...), au cas où une naissance rare se situe juste de l'autre côté d'une frontière plutôt que de
// s'arrêter artificiellement au contour français. Un point par (prénom, commune) — pas par personne —
// dont la taille encode le nombre de porteurs à cet endroit. Seuls les stats.highlightedNames (les
// GIVEN_NAME_HIGHLIGHT_COUNT prénoms rares dont les naissances sont les plus resserrées géographiquement,
// déjà sélectionnés par computeGivenNameStats) reçoivent chacun une couleur dédiée ; tous les autres
// prénoms rares restent en gris ("Autres") — avec potentiellement des dizaines de prénoms rares dans un
// fichier généalogique, colorer chacun rendrait la carte illisible.
export async function drawRareGivenNamesMap(containerId, stats) {
    if (!stats.mapReady) {
        showMapMessage(containerId, stats.geolocatedRareOccurrences > 0
            ? `Pas assez de prénoms rares géolocalisés pour une carte fiable (${stats.geolocatedRareOccurrences} point${stats.geolocatedRareOccurrences > 1 ? 's' : ''} pour l'instant).`
            : "Aucun prénom rare géolocalisé pour l'instant (résolution des coordonnées de commune en cours, ou aucune correspondance trouvée).");
        return;
    }

    showMapMessage(containerId, 'Chargement de la carte…');
    let geojsonRaw;
    try {
        geojsonRaw = await ensureFranceGeo();
    } catch (err) {
        showMapMessage(containerId, 'Impossible de charger la carte de France (connexion internet requise).', true);
        return;
    }
    const container = d3.select(`#${containerId}`);
    if (!document.getElementById(containerId)) return;

    const frenchDeptCodes = new Set(Object.values(GEO.deptNames));
    const features = geojsonRaw.features.filter(f => frenchDeptCodes.has(f.properties.code));

    // Contours des pays voisins : purement décoratifs ici (pas de comptage par pays comme dans
    // drawFranceMap), donc on ne bloque pas l'affichage de la France si cette requête échoue.
    let neighborFeatures = [];
    try {
        const europeGeo = await ensureEuropeGeo();
        neighborFeatures = europeGeo.features.filter(f => neighborCountryLabel(f) !== null);
    } catch (err) { /* pas de contours voisins, la carte de France seule reste fonctionnelle */ }
    if (!document.getElementById(containerId)) return;

    container.selectAll('*').remove();
    const containerWidth = container.node().clientWidth || 500, height = 420;
    // La légende (potentiellement une bonne quinzaine d'entrées, voir GIVEN_NAME_HIGHLIGHT_COUNT) est
    // dessinée dans une colonne à part à droite de la carte, plutôt qu'en superposition dessus (ce
    // qui masquait des points/contours en dessous) — même principe que la colonne "Liste éclair" de
    // drawDepartmentMap (maps.js). Sautée sous un seuil de largeur : pas la place de l'afficher
    // lisiblement (les points restent alors identifiables via leur infobulle au survol).
    const legendPanelWidth = containerWidth >= 620 ? 190 : 0;
    const mapWidth = containerWidth - legendPanelWidth;
    const svg = container.append('svg').attr('width', containerWidth).attr('height', height);

    // Même centrage/échelle que drawFranceMap (maps.js) pour la partie carte : les deux restent
    // superposables. Le translate ne prend en compte que mapWidth (pas containerWidth) pour recentrer
    // la carte dans l'espace qui lui reste une fois la colonne de légende retirée.
    const projection = d3.geoConicConformal().center([2.454071, 46.279229]).scale(height * 3.1).translate([mapWidth / 2, height / 2]);
    const path = d3.geoPath().projection(projection);

    // Viewport fixe (clip-path, jamais transformé) contenant le contenu zoomable (zoomLayer, qui lui
    // reçoit le transform de d3.zoom) : sans ce découpage en deux groupes, le rectangle de découpe
    // suivrait le zoom/pan au lieu de rester une fenêtre stable, et un panoramique ferait déborder la
    // carte sur la colonne de légende ou hors du cadre.
    const clipId = `rare-names-clip-${containerId}`;
    svg.append('defs').append('clipPath').attr('id', clipId)
        .append('rect').attr('x', 0).attr('y', 0).attr('width', mapWidth).attr('height', height);
    const viewport = svg.append('g').attr('clip-path', `url(#${clipId})`);
    const zoomLayer = viewport.append('g').attr('class', 'zoom-layer');

    if (neighborFeatures.length) {
        zoomLayer.selectAll('path.neighbor-bg').data(neighborFeatures).join('path').attr('class', 'neighbor-bg').attr('d', path)
            .attr('fill', '#f0f0f0').attr('stroke', '#bbb').attr('stroke-width', 0.6);
    }
    zoomLayer.selectAll('path.dept-bg').data(features).join('path').attr('class', 'dept-bg').attr('d', path)
        .attr('fill', '#f4f6f7').attr('stroke', '#ccc').attr('stroke-width', 0.6);

    const highlighted = stats.highlightedNames || [];
    const colorByKey = new Map(highlighted.map((h, i) => [h.key, RARE_GIVEN_NAME_HIGHLIGHT_COLORS[i % RARE_GIVEN_NAME_HIGHLIGHT_COLORS.length]]));
    const colorFor = key => colorByKey.get(key) || RARE_GIVEN_NAME_OTHER_COLOR;

    const plotted = stats.rarePoints
        .map(p => { const xy = projection([p.lon, p.lat]); return xy ? { ...p, x: xy[0], y: xy[1] } : null; })
        .filter(Boolean);
    const maxCount = d3.max(plotted, p => p.count) || 1;
    const radius = d3.scaleSqrt().domain([1, maxCount]).range([3, 12]);
    const tooltip = document.getElementById('tooltip');

    zoomLayer.selectAll('circle.rare-name').data(plotted).join('circle').attr('class', 'rare-name')
        .attr('cx', p => p.x).attr('cy', p => p.y).attr('r', p => radius(p.count))
        .attr('fill', p => colorFor(p.name)).attr('fill-opacity', 0.8).attr('stroke', '#fff').attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mouseover', function(e, p) {
            d3.select(this).attr('stroke', '#2c3e50').attr('stroke-width', 1.5);
            if (!tooltip) return;
            const shown = Math.min(10, p.items.length);
            const rows = p.items.slice(0, shown)
                .map(it => `<div class="tt-row"><span>${escapeHtml(it.personName || 'Inconnu')}</span><span>${it.year != null ? it.year : ''}</span></div>`)
                .join('');
            const more = p.count > shown ? `<div class="tt-row" style="opacity:.7;font-style:italic">…et ${p.count - shown} autre(s)</div>` : '';
            tooltip.style.opacity = 1;
            tooltip.innerHTML = `<strong>${escapeHtml(p.label)}${p.city ? ' — ' + escapeHtml(p.city) : ''}</strong>
                <div class="tt-row"><span>Occurrences ici</span><span>${p.count}</span></div>
                <div style="margin-top:6px;max-height:200px;overflow-y:auto">${rows}${more}</div>`;
        })
        .on('mousemove', e => {
            if (!tooltip) return;
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1);
            if (tooltip) tooltip.style.opacity = 0;
        });

    // Zoom/pan (molette + glisser) limité à la zone de carte (pas la colonne légende, voir le filtre
    // ci-dessous) : les naissances rares se comptent parfois par communes voisines, à peine séparables
    // au niveau de zoom initial (toute la France). Deux effets combinés aident à les distinguer en
    // zoomant : la projection écarte mécaniquement leurs centres (l'écart à l'écran croît avec k), ET
    // la taille APPARENTE des cercles rétrécit progressivement (via /sqrt(k), pas une simple taille
    // fixe) — sans ce second effet, garder une taille de cercle strictement constante à l'écran
    // n'apporte rien de plus que l'écartement seul pour séparer deux points encore proches. On ne va
    // pas jusqu'à laisser le rayon suivre le facteur d'échelle brut (radius * k, sans compensation) :
    // un cercle de 12px à k=1 deviendrait un disque de 96px à k=8, illisible et disproportionné.
    // screenRadius(count, k) = la taille voulue À L'ÉCRAN à ce niveau de zoom ; on assigne ensuite
    // l'attribut SVG r = screenRadius / k pour que le transform scale(k) du groupe reproduise
    // exactement cette taille (le groupe multiplie toute longueur, y compris r, par k).
    const screenRadius = (count, k) => Math.max(2, radius(count) / Math.sqrt(k));
    const zoom = d3.zoom()
        .scaleExtent([1, 10])
        .extent([[0, 0], [mapWidth, height]])
        .translateExtent([[0, 0], [mapWidth, height]])
        .filter(event => {
            if (event.button) return false;
            const [x] = d3.pointer(event, svg.node());
            return x <= mapWidth;
        })
        .on('zoom', event => {
            const k = event.transform.k;
            zoomLayer.attr('transform', event.transform);
            zoomLayer.selectAll('circle.rare-name').attr('r', p => screenRadius(p.count, k) / k).attr('stroke-width', 1 / k);
            zoomLayer.selectAll('path.dept-bg').attr('stroke-width', 0.6 / k);
            zoomLayer.selectAll('path.neighbor-bg').attr('stroke-width', 0.6 / k);
        });
    svg.style('cursor', 'grab').call(zoom);

    // Légende dessinée dans la colonne réservée à droite (legendPanelWidth), jamais en superposition
    // sur la carte — voir drawRareNamesLegendPanel ci-dessous, même principe que la "Liste éclair" de
    // drawDeptSurnamePanel (maps.js). Sautée entièrement si le conteneur est trop étroit pour cette
    // colonne (les points restent alors identifiables via leur infobulle au survol).
    const legendEntries = highlighted.map(h => ({
        label: h.name, detail: `${h.spreadKm.toFixed(0)} km`,
        title: `${h.name} — ≈ ${h.spreadKm.toFixed(0)} km entre communes`, color: colorByKey.get(h.key)
    }));
    if (stats.rareNameSummaries.length > highlighted.length) {
        legendEntries.push({ label: 'Autres prénoms rares', detail: null, title: 'Autres prénoms rares (non mis en évidence)', color: RARE_GIVEN_NAME_OTHER_COLOR });
    }
    if (legendPanelWidth > 0) {
        drawRareNamesLegendPanel(svg, mapWidth, legendPanelWidth, height, legendEntries);
    }
}

// Colonne de légende dessinée EN SVG, à droite de la carte (voir drawRareGivenNamesMap) : mêmes choix
// que drawDeptSurnamePanel (maps.js) — plafonnée au nombre de lignes qui tiennent verticalement, le
// reste résumé en "+N autre(s)" plutôt que débordé hors du cadre — pour rester cohérent visuellement
// avec l'autre panneau "liste à côté d'une carte" du site.
function drawRareNamesLegendPanel(svg, x0, panelWidth, height, entries) {
    svg.append('line').attr('x1', x0).attr('x2', x0).attr('y1', 10).attr('y2', height - 10).attr('stroke', '#ddd');

    const g = svg.append('g').attr('transform', `translate(${x0 + 16}, 22)`);
    g.append('text').attr('x', 0).attr('y', 0).style('font-size', '12px').style('font-weight', 700).style('fill', '#2c3e50')
        .text('🏷️ Prénoms mis en couleur');
    g.append('text').attr('x', 0).attr('y', 15).style('font-size', '9px').style('fill', '#888')
        .text(`${entries.length} entrée${entries.length > 1 ? 's' : ''}`);

    const rowHeight = 15, startY = 34, maxRows = Math.max(0, Math.floor((height - startY - 14) / rowHeight));
    const shown = entries.slice(0, maxRows);
    const detailX = panelWidth - 40;

    shown.forEach((entry, i) => {
        const y = startY + i * rowHeight;
        g.append('circle').attr('cx', 5).attr('cy', y - 3).attr('r', 4.5).attr('fill', entry.color);
        g.append('text').attr('x', 14).attr('y', y).style('font-size', '10.5px').style('fill', '#333')
            .text(entry.label.length > 13 ? entry.label.slice(0, 12) + '…' : entry.label)
            .append('title').text(entry.title);
        if (entry.detail) {
            g.append('text').attr('x', detailX).attr('y', y).attr('text-anchor', 'end')
                .style('font-size', '9px').style('fill', '#7f8c8d').text(entry.detail);
        }
    });
    if (entries.length > shown.length) {
        g.append('text').attr('x', 0).attr('y', startY + shown.length * rowHeight + 2)
            .style('font-size', '9.5px').style('font-style', 'italic').style('fill', '#888')
            .text(`+${entries.length - shown.length} autre(s)`);
    }
}
