// --- MARIAGE : lien direct vers les tables des contrats de mariage (fonds Enregistrement) ---
// Même principe que successions.js (lien vers le bon registre, pas vers le bon acte précis), mais
// indexé sur la FAMILLE (f.marr, un contrat de mariage concerne le couple, pas un individu isolé) :
// une ligne par couple, pas une ligne par personne comme les autres modes - contrairement à
// p.marrYear (la plus ANCIENNE date de mariage d'un individu, utilisée par notaires.js), ceci
// couvre CHAQUE mariage d'une personne qui s'est remariée, pas seulement le premier.
//
// Couverture pilote (2 départements, voir scripts_py/scrape_contrats_mariage_arkotheque.py) : les
// deux sont sur le même portail "Arkothèque" que Paris/Allier (successions.js), dépouillés au sein
// du même fonds "9Q Enregistrement"/"Contrôle des actes" que la série successions déjà couverte,
// simplement filtrés sur l'intitulé "contrats de mariage" plutôt que "successions et absences".
//
// Pour couvrir un nouveau département : écrire son propre scraper (même famille que
// scripts_py/scrape_successions_*.py), générer son JSON sous assets/data/, puis ajouter une entrée
// ci-dessous. Si un futur département publie une mécanique de correspondance différente (bureau
// géographique sans commune exacte, subdivision par patronyme...), suivre l'exemple du système
// 'kind' de successions.js plutôt que de le réinventer ici.
import { deptCode, normalizePlace } from './geo.js';

export const MARRIAGE_DEPTS = {
    '78': {
        label: 'Yvelines',
        // Bornes réelles de la série (42 registres scrapés, voir
        // scrape_contrats_mariage_arkotheque.py).
        minYear: 1760,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_78.json',
        catalogUrl: 'https://archives.yvelines.fr/rechercher/archives-en-ligne/enregistrementbrtables-referencant-les-actesbret-declarations-de-successions/tables-de-lenregistrement',
    },
    '43': {
        label: 'Haute-Loire',
        // Bornes réelles de la série (157 registres scrapés, voir
        // scrape_contrats_mariage_arkotheque.py).
        minYear: 1737,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_43.json',
        catalogUrl: 'https://www.archives43.fr/archives-en-ligne/familles-et-individus-en-haute-loire/tables-du-controle-des-actes-et-de-lenregistrement',
    },
    '31': {
        label: 'Haute-Garonne',
        // Bornes réelles de la série (21 registres scrapés sur 30 bureaux — les 9 restants n'ont
        // pas de "Table des contrats de mariage" cataloguée dans ce fonds, voir
        // scrape_contrats_mariage_haute_garonne.py). Portail Ligeo Archives derrière Anubis, même
        // autorisation explicite que la série successions de ce département.
        minYear: 1763,
        maxYear: 1866,
        registersUrl: './assets/data/contrats_mariage_31.json',
        catalogUrl: 'https://archives.haute-garonne.fr/n/enregistrement/n:352',
    },
    '72': {
        label: 'Sarthe',
        // Bornes réelles de la série (113 registres scrapés, 30 lieux distincts, voir
        // scrape_contrats_mariage_arkotheque.py). Même portail Arkothèque que 78/43, déjà mixé
        // avec les successions sur cette même page (pas de découverte séparée nécessaire).
        minYear: 1776,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_72.json',
        catalogUrl: 'https://archives.sarthe.fr/archives-en-ligne/tables-de-lenregistrement-sous-serie-3-q',
    },
    '82': {
        label: 'Tarn-et-Garonne',
        // Bornes réelles de la série (106 registres scrapés, 20 bureaux, voir
        // scrape_contrats_mariage_tarn_et_garonne.py). Même document Anaphore/Bach unique que les
        // successions de ce département (FRAD082_IR_00383), qui mélange déjà tous les types
        // d'actes du fonds "Enregistrement" - la table des contrats de mariage y est un noeud
        // frère de "Table des successions et absences", filtré côté client comme elle.
        minYear: 1755,
        maxYear: 1866,
        registersUrl: './assets/data/contrats_mariage_82.json',
        catalogUrl: 'https://recherche.archives82.fr/document/FRAD082_IR_00383',
    },
    '30': {
        label: 'Gard',
        // Bornes réelles de la série (136 registres scrapés, 29 lieux, voir
        // scrape_contrats_mariage_anaphore.py). Portail Anaphore/Bach, fonds "Enregistrement" par
        // bureau : "Contrats de mariage" est un dossier frère de "Table alphabétique des
        // successions et absences" dans chaque document de bureau.
        minYear: 1750,
        maxYear: 1869,
        registersUrl: './assets/data/contrats_mariage_30.json',
        catalogUrl: 'https://earchives.gard.fr/document/FRAD030_ENREGISTREMENT',
    },
    '22': {
        label: "Côtes-d'Armor",
        // Bornes réelles de la série (41 registres scrapés, 28 lieux, voir
        // scrape_contrats_mariage_anaphore.py). Même logiciel/mécanique que le Gard.
        minYear: 1765,
        maxYear: 1873,
        registersUrl: './assets/data/contrats_mariage_22.json',
        catalogUrl: 'https://recherche.archives.cotesdarmor.fr/archives/classification-scheme',
    },
    '70': {
        label: 'Haute-Saône',
        // Bornes réelles de la série (36 registres scrapés, 15 lieux, voir
        // scrape_contrats_mariage_haute_saone.py) : extraits des pages déjà en cache pour les
        // successions (portail Ligeo Archives + Anubis, mode "titletext_bureau") - ce fonds
        // mélangeait déjà les deux séries dans les mêmes résultats de recherche libre par bureau.
        // Pas de cote officielle exposée pour ces lignes (contrairement aux successions du même
        // portail) : le libellé complet du registre sert d'identifiant, voir le scraper.
        minYear: 1722,
        maxYear: 1808,
        registersUrl: './assets/data/contrats_mariage_70.json',
        catalogUrl: 'https://archives.haute-saone.fr/archive/recherche/enregistrement/n:121',
    },
    '86': {
        label: 'Vienne',
        // Bornes réelles de la série (62 registres scrapés, 21 lieux, voir
        // scrape_contrats_mariage_ligeo_anubis.py) : facette RECH_type "table des contrats de
        // mariage" découverte via le widget d'autocomplétion du portail (même portail Ligeo
        // Archives + Anubis que la Deux-Sèvres, distingué par RECH_dep).
        minYear: 1752,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_86.json',
        catalogUrl: 'https://archives-deux-sevres-vienne.fr/archive/recherche/enregistrement/n:101',
    },
    '79': {
        label: 'Deux-Sèvres',
        // Bornes réelles de la série (100 registres scrapés, 23 lieux, voir
        // scrape_contrats_mariage_ligeo_anubis.py). Même portail que la Vienne.
        minYear: 1705,
        maxYear: 1866,
        registersUrl: './assets/data/contrats_mariage_79.json',
        catalogUrl: 'https://archives-deux-sevres-vienne.fr/archive/recherche/enregistrement/n:101',
    },
    '16': {
        label: 'Charente',
        // Bornes réelles de la série (46 registres scrapés, 23 lieux, voir
        // scrape_contrats_mariage_ligeo_anubis.py) : facette REch_typeformalites "Table des
        // contrats de mariage" découverte via le widget d'autocomplétion (portail Ligeo Archives +
        // Anubis, même autorisation explicite que la série successions de ce département).
        minYear: 1718,
        maxYear: 1814,
        registersUrl: './assets/data/contrats_mariage_16.json',
        catalogUrl: 'https://lasource.archives.lacharente.fr/archive/recherche/enregistrement/n:127',
    },
    '33': {
        label: 'Gironde',
        // Bornes réelles de la série (186 registres scrapés, 17 lieux, voir
        // scrape_contrats_mariage_ligeo_anubis.py) : facette RECH_table "Table des contrats de
        // mariage" (deux facettes proches existaient - "Tables des contrats de mariage" au
        // pluriel, et une "Contrôle des extraits de baptême et mariages" hors-sujet - la première
        // correspondance stricte est retenue, voir MARRIAGE_FACET_RE dans le scraper).
        minYear: 1703,
        maxYear: 1877,
        registersUrl: './assets/data/contrats_mariage_33.json',
        catalogUrl: 'https://archives.gironde.fr/archive/recherche/enregistrement2',
    },
    '48': {
        label: 'Lozère',
        // Bornes réelles de la série (55 registres scrapés, 14 lieux, voir
        // scrape_contrats_mariage_lozere.py) : arbre complet du fonds "Enregistrement" déjà rendu
        // en une seule recherche (comme les successions de ce département), simplement filtré côté
        // serveur sur la case à cocher "mariage" au lieu de "successions".
        minYear: 1779,
        maxYear: 1866,
        registersUrl: './assets/data/contrats_mariage_48.json',
        catalogUrl: 'https://archives.lozere.fr/archive/recherche/enregistrement/n:305',
    },
    '69': {
        label: 'Rhône',
        // Bornes réelles de la série (175 registres scrapés, 25 lieux, voir
        // scrape_contrats_mariage_rhone.py) : ce département n'a pas de recherche sauvegardée
        // (formUuid) comme les autres du même portail, mais une recherche par mot-clé sur le champ
        // "controlledAccessPhysicalCharacteristic" fonctionne directement pour "Table des contrats
        // de mariage" comme elle le fait déjà pour les successions.
        minYear: 1730,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_69.json',
        catalogUrl: 'https://archives.rhone.fr/search/results?target=controlledAccessPhysicalCharacteristic&keyword=Table+des+contrats+de+mariage&mode=list&sort=referencecode_asc',
    },
    '27': {
        label: 'Eure',
        // Bornes réelles de la série (137 registres scrapés, 31 lieux, voir
        // scrape_contrats_mariage_multi.py) : même portail à formUuid que les successions de ce
        // département, mais interrogé directement par mot-clé sur
        // "controlledAccessPhysicalCharacteristic" (comme le Rhône) plutôt que via le formUuid
        // d'origine (pré-filtré sur la seule série successions).
        minYear: 1743,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_27.json',
        catalogUrl: 'https://archives.eure.fr/search/results?target=controlledAccessPhysicalCharacteristic&keyword=Table+des+contrats+de+mariage&mode=list&sort=referencecode_asc',
    },
    '90': {
        label: 'Territoire de Belfort',
        // Bornes réelles de la série (10 registres scrapés, 2 lieux, voir
        // scrape_contrats_mariage_multi.py) : même technique que l'Eure/le Rhône (mot-clé sur
        // "controlledAccessPhysicalCharacteristic"), sans le filtre "facet_media=image" habituel -
        // ces notices n'ont pas d'image numérisée associée mais restent de vrais registres
        // catalogués (cote/dates réelles).
        minYear: 1791,
        maxYear: 1869,
        registersUrl: './assets/data/contrats_mariage_90.json',
        catalogUrl: 'https://archives.territoiredebelfort.fr/search/results?target=controlledAccessPhysicalCharacteristic&keyword=Table+des+contrats+de+mariage&mode=list&sort=referencecode_asc',
    },
    '71': {
        label: 'Saône-et-Loire',
        // Bornes réelles de la série (70 registres scrapés, 34 lieux, voir
        // scrape_contrats_mariage_arkotheque.py) : département ABSENT de SUCCESSION_DEPTS (son
        // fonds "Contrôle des actes et enregistrement" n'a pas de table "successions et absences"
        // du tout, voir la liste "non couverts" ci-dessus) mais possède bien une "Table
        // alphabétique des contrats de mariage" — repéré en resondant ce même fonds pour ce mode.
        // Pas de cote officielle exposée sur ce déploiement (même limitation que le Maine-et-Loire
        // pour les successions, voir DEPARTMENTS['49'] dans scrape_successions_arkotheque.py).
        minYear: 1729,
        maxYear: 1812,
        registersUrl: './assets/data/contrats_mariage_71.json',
        catalogUrl: 'https://www.archives71.fr/consulter/en-ligne/familles-et-individus/controle-des-actes-et-enregistrement',
    },
    '05': {
        label: 'Hautes-Alpes',
        // Bornes réelles de la série (79 registres scrapés, 24 lieux, voir
        // scrape_contrats_mariage_hautes_alpes.py) : département ABSENT de SUCCESSION_DEPTS (son
        // fonds Enregistrement en ligne n'a que les "successions collatérales", pas la table
        // "successions et absences") mais avec une case "Mariage" (portail Ligeo Archives) donnant
        // de vrais résultats catalogués. Particularité : le tableau de résultats ne publie pas la
        // commune, seule la fiche individuelle de chaque notice l'expose (voir le scraper).
        minYear: 1750,
        maxYear: 1958,
        registersUrl: './assets/data/contrats_mariage_05.json',
        catalogUrl: 'https://archives.hautes-alpes.fr/archive/recherche/enregistrement/n:214',
    },
    '36': {
        label: 'Indre',
        // Bornes réelles de la série (67 registres scrapés, 17 lieux, voir
        // scrape_contrats_mariage_arkotheque.py) : département ABSENT de SUCCESSION_DEPTS (son
        // fonds numérisé n'a que la table pré-1825 "successions acquittées", pas "successions et
        // absences") mais avec une "Table des contrats de mariage" bien présente dans ce fonds.
        minYear: 1790,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_36.json',
        catalogUrl: 'https://www.archives36.fr/fonds-numerises/enregistrement-sous-serie-3-q',
    },
    '15': {
        label: 'Cantal',
        // Bornes réelles de la série (127 registres scrapés, 21 lieux, voir
        // scrape_contrats_mariage_arkotheque.py) : page Arkothèque dédiée "...-numerisees"
        // distincte de la page successions (déjà couverte, voir '15' dans SUCCESSION_DEPTS),
        // trouvée par recherche web plutôt qu'en resondant le fonds Enregistrement général (qui
        // n'expose pas de type_field exploitable sur ce déploiement).
        minYear: 1731,
        maxYear: 1867,
        registersUrl: './assets/data/contrats_mariage_15.json',
        catalogUrl: 'https://www.archives.cantal.fr/rechercher/genealogie/tables-des-contrats-de-mariage-numerisees',
    },
    '18': {
        label: 'Cher',
        // Bornes réelles de la série (106 registres scrapés, 29 lieux, voir
        // scrape_contrats_mariage_arkotheque.py) : page Arkothèque dédiée séparée de la page
        // successions (déjà couverte), trouvée par recherche web.
        minYear: 1750,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_18.json',
        catalogUrl: 'https://www.archives18.fr/archives-numerisees/tables-de-mariages-de-lenregistrement',
    },
    '83': {
        label: 'Var',
        // Bornes réelles de la série (329 registres scrapés sur les 100 premières pages du fonds
        // - le portail plafonne l'accès à ~10 000 résultats bruts, voir
        // scrape_contrats_mariage_arkotheque.py DEPARTMENTS['83']) : département débloqué après
        // découverte de la nouvelle URL de recherche (l'ancienne, documentée dans le blocage
        // "successions" de ce fichier, est un 404 depuis une refonte du site).
        minYear: 1705,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_83.json',
        catalogUrl: 'https://archives.var.fr/recherche/rechercher-dans-les-archives-numerisees-et-les-inventaires/controle-des-actes-et-enregistrement',
    },
    '84': {
        label: 'Vaucluse',
        // Bornes réelles de la série (33 registres, 7 bureaux, voir
        // scrape_contrats_mariage_vaucluse.py) - la facette cCorpname utilisée côté successions ne
        // remonte pas ce noeud de façon fiable ; trouvé en repli via l'arbre complet de chaque
        // bureau ("/document/<IR id>"). Tous les registres sont numérisés.
        minYear: 1772,
        maxYear: 1865,
        registersUrl: './assets/data/contrats_mariage_84.json',
        catalogUrl: 'https://earchives.vaucluse.fr/archives/search?filter_field=cCorpname&filter_value=Bureau+de+l%27enregistrement+d%27Avignon',
    },
    '60': {
        label: 'Oise',
        // Bornes réelles de la série (16 registres, 12 lieux, voir
        // scrape_contrats_mariage_archinoe.py) - même portail Archinoë que les successions de
        // l'Oise, "Tables des contrats de mariage" est une valeur soeur du même sélecteur
        // "type_registre" (pas trouvée pour Loire-Atlantique, même famille de logiciel).
        minYear: 1729,
        maxYear: 1810,
        registersUrl: './assets/data/contrats_mariage_60.json',
        catalogUrl: 'https://ressources.archives.oise.fr/v2/ad60/tsa.html',
    },
};

function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
}

// Candidates à essayer pour une correspondance de commune, du lieu le plus précis (lieu-dit/hameau
// tel qu'acté) jusqu'au lieu parent le plus général connu — voir geo.cityChain dans gedcom.js et le
// même principe dans successions.js/cityCandidates.
function cityCandidates(geo) {
    return (geo.cityChain && geo.cityChain.length) ? geo.cityChain : [geo.city];
}
function parentContextLabel(geo, matched) {
    return matched !== geo.city ? `"${geo.city}" non reconnu — résolu via le lieu parent "${matched}"` : null;
}

// Comme pickRegisters dans successions.js : renvoie les registres couvrant l'année recherchée, ou à
// défaut le plus proche dans le temps (bornes de registre imprécises plutôt qu'aucune piste).
// yearGap (0 quand l'année est bien couverte) accompagne ce repli pour signaler une approximation
// potentiellement lointaine à l'affichage.
function pickRegisters(records, year) {
    if (!records || !records.length) return { registers: [], yearGap: 0 };
    const containing = records.filter(r => year >= r.yearStart && year <= r.yearEnd);
    if (containing.length) return { registers: containing, yearGap: 0 };
    let best = records[0], bestDist = Infinity;
    records.forEach(r => {
        const dist = year < r.yearStart ? r.yearStart - year : year - r.yearEnd;
        if (dist < bestDist) { bestDist = dist; best = r; }
    });
    return { registers: [best], yearGap: bestDist };
}

function loadDeptIndex(deptCodeKey) {
    const config = MARRIAGE_DEPTS[deptCodeKey];
    return fetchJson(config.registersUrl)
        .then(records => {
            const registerIndex = new Map();
            records.forEach(r => {
                const key = normalizePlace(r.place);
                if (!registerIndex.has(key)) registerIndex.set(key, []);
                registerIndex.get(key).push(r);
            });
            return { config, registerIndex };
        })
        .catch(err => {
            console.error(`Chargement des contrats de mariage (dept ${deptCodeKey}) échoué:`, err);
            return { config, registerIndex: new Map() };
        });
}

const indexPromises = new Map();

// Démarre le chargement de tous les départements couverts dès l'import du module (même principe
// que loadSuccessionIndexes/loadNotairesIndex) : un échec partiel n'empêche pas les autres
// départements de fonctionner.
export function loadMarriageIndexes() {
    return Promise.all(
        Object.keys(MARRIAGE_DEPTS).map(dc => {
            if (!indexPromises.has(dc)) indexPromises.set(dc, loadDeptIndex(dc));
            return indexPromises.get(dc).then(idx => [dc, idx]);
        })
    ).then(entries => new Map(entries));
}

function resolveRegisters(idx, geo, year) {
    for (const candidate of cityCandidates(geo)) {
        const exact = idx.registerIndex.get(normalizePlace(candidate));
        if (exact && exact.length) {
            const picked = pickRegisters(exact, year);
            return { matchType: 'exact', registers: picked.registers, yearGap: picked.yearGap, contextLabel: parentContextLabel(geo, candidate) };
        }
    }
    return { matchType: 'none', registers: [], yearGap: 0, contextLabel: null };
}

// fams: Map (voir GedcomParser.fams) — chaque famille porte son propre événement de mariage
// (f.marr : year/geo/day/month/approx), déjà normalisé par finalizeAllGeo() comme n'importe quel
// autre lieu du GEDCOM (geo.city/geo.dept/geo.cityChain).
// map: Map id -> individu, pour résoudre f.husb/f.wife en objets personne complets.
// indexes: Map département -> {config, registerIndex} (voir loadMarriageIndexes)
// opts: { ancestorScopeSet } — une famille est retenue si AU MOINS un des deux conjoints est dans
// le périmètre (l'autre peut être un conjoint "entré" par mariage, hors de la lignée de sang).
export function computeMarriageLeads(fams, map, indexes, opts) {
    opts = opts || {};
    const results = [];
    fams.forEach(f => {
        if (opts.ancestorScopeSet) {
            const husbIn = f.husb && opts.ancestorScopeSet.has(f.husb);
            const wifeIn = f.wife && opts.ancestorScopeSet.has(f.wife);
            if (!husbIn && !wifeIn) return;
        }
        const year = f.marr?.year;
        const geo = f.marr?.geo;
        if (year == null || !geo || !geo.city || !geo.dept) return;

        const husb = f.husb ? map.get(f.husb) : null;
        const wife = f.wife ? map.get(f.wife) : null;
        if (!husb && !wife) return; // ni époux ni épouse identifiable (ne devrait pas arriver)

        const dc = deptCode(geo.dept);
        const idx = indexes.get(dc);
        if (!idx) return; // département non couvert par ce module
        const { config } = idx;
        if (year < config.minYear || year > config.maxYear) return; // hors des bornes de la série

        const resolved = resolveRegisters(idx, geo, year);
        results.push({
            fam: f, husb, wife, marrEvent: f.marr, year, city: geo.city, dept: dc, deptLabel: config.label,
            ...resolved,
            fallbackUrl: resolved.registers.length ? null : config.catalogUrl,
        });
    });
    return results;
}
