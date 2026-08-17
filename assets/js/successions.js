// --- SUCCESSIONS : lien direct vers les tables des successions et absences (série 3Q) ---
// Pour chaque ancêtre décédé à une date et une commune connues dans un département couvert
// ci-dessous, un lien vers le(s) registre(s) du portail des Archives départementales concerné,
// dans la série des tables des successions et absences. Ces portails n'ont PAS d'index nominatif
// sur cette série : le lien pointe vers un registre (un volume de plusieurs années, à feuilleter
// soi-même), pas vers un acte précis — même principe que le mode Recensement (lien vers le bon
// registre, pas vers la bonne ligne).
//
// Chaque département a son propre portail (logiciel, structure, URL différents), donc son propre
// jeu de données précalculé par scripts_py/scrape_successions_<dept>.py. Deux mécaniques de
// correspondance commune -> registre coexistent, selon ce que le département publie
// (config.kind) :
// - 'facet' (Nord 59, Tarn-et-Garonne 82, Seine-Maritime 76) : le portail liste les registres par
//   ville-siège de "bureau d'enregistrement" (ancien régime), sans table officielle commune ->
//   bureau ; l'app calcule un repli par proximité géographique
//   (scripts_py/build_successions_*_bureaux.py), approximatif et présenté comme tel. Le nom
//   "facet" vient du Nord (recherche à facettes) même si Tarn-et-Garonne et Seine-Maritime sont en
//   réalité des arbres de classement (deux logiciels différents en plus) : ce qui définit le kind,
//   c'est la mécanique de correspondance (bureau seul, sans initiale de patronyme), pas la forme
//   du portail — voir fallbackUrl plus bas, qui lui dépend du portail (config.formUuid).
// - 'bureau-letter' (Tarn, 81) : le département publie lui-même la vraie table historique commune
//   -> bureau (avec ses dates de changement, scripts_py/build_successions_tarn_communes.py) ET ses
//   registres sont eux-mêmes classés par bureau PUIS par initiale de patronyme (répertoires
//   alphabétiques) : la correspondance est donc exacte, pas une approximation, et plus précise
//   qu'à Nord puisqu'elle peut aussi cibler la bonne tranche de patronymes.
// - 'citywide' (Paris, 75) : cas particulier — le département ne compte qu'une seule commune, donc
//   pas de correspondance commune -> bureau à faire ni de repli géographique ; les registres sont
//   organisés par arrondissement (avec des découpages qui ont changé dans le temps, y compris des
//   "arrondissements anciens" antérieurs à 1860), une information que le GEDCOM ne connaît
//   généralement pas. On renvoie donc tous les registres de l'année recherchée, quel que soit
//   l'arrondissement, à charge pour la personne de repérer le bon (voir resolveCitywide).
//
// Pour couvrir un nouveau département : écrire son propre scraper (le HTML/la structure varient
// d'un portail à l'autre), générer ses JSON sous assets/data/, puis ajouter une entrée à
// SUCCESSION_DEPTS avec le 'kind' qui correspond le mieux à ce que ce portail publie — en
// ajoutant un nouveau kind si aucun des deux existants ne convient.
import { deptCode, normalizePlace } from './geo.js';

export const SUCCESSION_DEPTS = {
    '59': {
        label: 'Nord',
        kind: 'facet',
        // Bornes réelles de la série : pas de registre en dehors de cette période (vérifié en
        // parcourant l'intégralité des 1932 registres scrapés, voir scrape_successions_nord.py).
        minYear: 1791,
        maxYear: 1970,
        portalBase: 'https://archivesdepartementales.lenord.fr/search/results',
        formUuid: '6eaeac65-9e1b-43ea-bc9f-902abd458466',
        registersUrl: './assets/data/successions_59.json',
        bureauxUrl: './assets/data/successions_59_bureaux.json',
    },
    '81': {
        label: 'Tarn',
        kind: 'bureau-letter',
        // Bornes réelles de la série (8523 registres scrapés, voir scrape_successions_tarn.py).
        minYear: 1790,
        maxYear: 1973,
        registersUrl: './assets/data/successions_81.json',
        communesUrl: './assets/data/successions_81_communes.json',
        // Repli quand aucun registre précis n'a pu être identifié : la page de la série entière,
        // à parcourir soi-même (pas d'équivalent du "browse par année seule" du Nord ici, ce
        // portail étant un arbre de classement plutôt qu'une recherche à facettes).
        catalogUrl: 'https://recherche-archives.tarn.fr/document/FRAD081_TablesSuccessionsAbsences',
    },
    '82': {
        label: 'Tarn-et-Garonne',
        kind: 'facet',
        // Bornes réelles de la série (224 registres scrapés, voir
        // scrape_successions_tarn_et_garonne.py) : contrairement à Nord/Tarn, seule la période
        // 1825-1969 est couverte par la "Table des successions et absences" proprement dite — la
        // table antérieure ("Table des successions acquittées") existe mais porte un autre nom et
        // n'est pas dépouillée ici (même logique que pour Le Fraysse au Tarn : mieux vaut aucune
        // piste qu'une piste sous un nom de série qu'on n'a pas vérifié).
        minYear: 1824,
        maxYear: 1969,
        registersUrl: './assets/data/successions_82.json',
        bureauxUrl: './assets/data/successions_82_bureaux.json',
        // Comme le Tarn, ce portail (même logiciel Anaphore) est un arbre de classement, pas une
        // recherche à facettes façon Nord : pas de "browse par année seule", repli sur la page de
        // la série entière.
        catalogUrl: 'https://recherche.archives82.fr/document/FRAD082_IR_00383',
    },
    '76': {
        label: 'Seine-Maritime',
        kind: 'facet',
        // Bornes réelles de la série (46 bureaux scrapés sur 47, voir
        // scrape_successions_seine_maritime.py) : structure la plus simple des quatre départements
        // couverts — un seul item numérisé par bureau (pas de subdivision par volume ni par
        // patronyme), directement le lien "bon registre" recherché.
        minYear: 1767,
        maxYear: 1970,
        registersUrl: './assets/data/successions_76.json',
        bureauxUrl: './assets/data/successions_76_bureaux.json',
        // Portail "Ligeo Archives" (Boscop), un troisième logiciel différent de Nord et
        // Tarn/Tarn-et-Garonne (Anaphore) : arbre de classement plutôt que recherche à facettes,
        // repli sur la liste des bureaux à parcourir soi-même.
        catalogUrl: 'https://www.archivesdepartementales76.net/n/enregistrement/n:275',
    },
    '37': {
        label: 'Indre-et-Loire',
        kind: 'facet',
        // Bornes réelles de la série (389 registres scrapés, voir scrape_successions_multi.py) -
        // corrigé après coup : le formUuid, malgré son nom, couvrait en réalité tout le fonds
        // "Enregistrement" (dont les déclarations de succession brutes, une source différente des
        // tables d'index visées ici) ; voir is_tsa_record_type dans le scraper. Repéré et corrigé
        // le 2026-08-17 - avant cette date, ce département pouvait pointer vers la mauvaise série.
        minYear: 1824,
        maxYear: 1968,
        portalBase: 'https://archives.touraine.fr/search/results',
        formUuid: 'f311e3b2-110c-43a5-a051-4585d7499fb9',
        registersUrl: './assets/data/successions_37.json',
        bureauxUrl: './assets/data/successions_37_bureaux.json',
    },
    '80': {
        label: 'Somme',
        kind: 'facet',
        // Bornes réelles de la série (434 registres scrapés, voir scrape_successions_multi.py).
        minYear: 1849,
        maxYear: 1968,
        portalBase: 'https://archives.somme.fr/search/results',
        formUuid: '93527461-9c14-4642-9a84-e3207e365911',
        registersUrl: './assets/data/successions_80.json',
        bureauxUrl: './assets/data/successions_80_bureaux.json',
    },
    '58': {
        label: 'Nièvre',
        kind: 'facet',
        // Bornes réelles de la série (413 registres scrapés, voir scrape_successions_multi.py).
        minYear: 1790,
        maxYear: 1969,
        portalBase: 'https://archives.nievre.fr/search/results',
        formUuid: 'e3e37b84-2953-47f1-a6af-d590b7c568e3',
        registersUrl: './assets/data/successions_58.json',
        bureauxUrl: './assets/data/successions_58_bureaux.json',
    },
    '25': {
        label: 'Doubs',
        kind: 'facet',
        // Bornes réelles de la série (258 registres scrapés, voir scrape_successions_multi.py) -
        // corrigé après coup le 2026-08-17, même cause qu'Indre-et-Loire (voir son commentaire) :
        // des items d'une sous-série voisine (déclarations brutes, pas les tables d'index)
        // étaient mélangés aux vrais registres.
        minYear: 1776,
        maxYear: 1969,
        portalBase: 'https://portail-archives.doubs.fr/search/results',
        formUuid: '34159447-4567-4f9b-a44b-4dc5894ad2f4',
        registersUrl: './assets/data/successions_25.json',
        bureauxUrl: './assets/data/successions_25_bureaux.json',
    },
    '30': {
        label: 'Gard',
        kind: 'facet',
        // Bornes réelles de la série (491 registres scrapés, voir scrape_successions_gard.py).
        minYear: 1821,
        maxYear: 1969,
        registersUrl: './assets/data/successions_30.json',
        bureauxUrl: './assets/data/successions_30_bureaux.json',
        // Quatrième département sur le logiciel Anaphore (Tarn, Tarn-et-Garonne, Gard) : arbre de
        // classement, pas de recherche à facettes façon Nord — repli sur le fonds "Enregistrement".
        catalogUrl: 'https://earchives.gard.fr/document/FRAD030_ENREGISTREMENT',
    },
    '60': {
        label: 'Oise',
        kind: 'facet',
        // Bornes réelles de la série (599 registres scrapés, voir scrape_successions_archinoe.py).
        minYear: 1740,
        maxYear: 1970,
        registersUrl: './assets/data/successions_60.json',
        bureauxUrl: './assets/data/successions_60_bureaux.json',
        // Portail "Archinoë" (v2/adXX), un quatrième logiciel : simple formulaire bureau + type de
        // registre, une seule requête pour tout le département (pas de facette/arbre à parcourir).
        catalogUrl: 'https://ressources.archives.oise.fr/v2/ad60/tsa.html',
    },
    '22': {
        label: "Côtes-d'Armor",
        kind: 'facet',
        // Bornes réelles de la série (570 registres scrapés, voir
        // scrape_successions_anaphore_per_bureau.py).
        minYear: 1814,
        maxYear: 1968,
        registersUrl: './assets/data/successions_22.json',
        bureauxUrl: './assets/data/successions_22_bureaux.json',
        // Cinquième département sur le logiciel Anaphore, un document par bureau comme le Gard.
        catalogUrl: 'https://recherche.archives.cotesdarmor.fr/archives/classification-scheme',
    },
    '31': {
        label: 'Haute-Garonne',
        kind: 'facet',
        // Bornes réelles de la série (664 registres scrapés, voir
        // scrape_successions_haute_garonne.py) - corrigé le 2026-08-17 : les feuilles regroupées
        // par ANNÉE puis par tranche de patronyme (ex. Toulouse : "1964" > "F-O (n°2)", aucune
        // date dans ce dernier libellé) étaient silencieusement perdues faute d'héritage de
        // l'année du dossier parent - repéré via deux pistes signalées comme manquantes/fausses.
        minYear: 1787,
        maxYear: 1968,
        registersUrl: './assets/data/successions_31.json',
        bureauxUrl: './assets/data/successions_31_bureaux.json',
        // Portail "Ligeo Archives" (même logiciel que la Seine-Maritime), protégé par Anubis
        // (anti-bot) : le dépouillement n'a été fait qu'après autorisation explicite du service
        // d'archives (voir scrape_successions_haute_garonne.py) — cas particulier, à ne pas
        // reproduire pour un autre département sans la même autorisation.
        catalogUrl: 'https://archives.haute-garonne.fr/n/enregistrement/n:352',
    },
    '44': {
        label: 'Loire-Atlantique',
        kind: 'facet',
        // Bornes réelles de la série (886 registres scrapés, voir scrape_successions_archinoe.py).
        minYear: 1786,
        maxYear: 1969,
        registersUrl: './assets/data/successions_44.json',
        bureauxUrl: './assets/data/successions_44_bureaux.json',
        // Même logiciel "Archinoë" que l'Oise, mais interrogé bureau par bureau (pas d'option
        // "tous bureaux" exploitable sur ce formulaire) — voir DEPARTMENTS['44'] dans le scraper.
        catalogUrl: 'https://archives-numerisees.loire-atlantique.fr/v2/ad44/table3q.html',
    },
    '75': {
        label: 'Paris',
        kind: 'citywide',
        // Bornes réelles de la série (3909 registres scrapés, voir scrape_successions_paris.py) :
        // la série s'intitule "1791-vers 1953" mais quelques registres tardifs dépassent 1953.
        minYear: 1788,
        maxYear: 1967,
        registersUrl: './assets/data/successions_75.json',
        // Portail "Arkothèque", un sixième logiciel différent des autres départements couverts ici.
        // Pas de bureauxUrl/catalogUrl de repli au sens des autres kind : voir resolveCitywide.
        catalogUrl: 'https://archives.paris.fr/archives-numerisees/archives-fiscales/successions/consulter-les-tables-des-deces-et-des-successions-1791-vers-1953',
    },
    '03': {
        label: 'Allier',
        kind: 'facet',
        // Bornes réelles de la série (407 registres scrapés, voir
        // scrape_successions_arkotheque.py).
        minYear: 1782,
        maxYear: 1968,
        registersUrl: './assets/data/successions_03.json',
        bureauxUrl: './assets/data/successions_03_bureaux.json',
        // Portail "Arkothèque" (même logiciel que Paris), mais sans subdivision par patronyme -
        // un registre par (bureau, tranche d'années), donc kind 'facet' ordinaire ici.
        catalogUrl: 'https://archives.allier.fr/archives-en-ligne/tables-des-successions-et-absences',
    },
    '90': {
        label: 'Territoire de Belfort',
        kind: 'facet',
        // Bornes réelles de la série (83 registres scrapés, voir scrape_successions_multi.py) :
        // plus petit département de la France métropolitaine, seulement 2 bureaux (dont un partagé
        // entre 3 communes - Delle, Fontaine, Giromagny - voir bureauNamesFromPlace plus haut). Ce
        // formUuid couvrait en réalité tout le fonds "Enregistrement" (partages, testaments,
        // successions acquittées...) avant filtrage par is_tsa_record_type - voir son commentaire.
        minYear: 1791,
        maxYear: 1968,
        portalBase: 'https://archives.territoiredebelfort.fr/search/results',
        formUuid: '4a39b8c2-efbf-4502-a0a4-8f10350fa0a8',
        registersUrl: './assets/data/successions_90.json',
        bureauxUrl: './assets/data/successions_90_bureaux.json',
    },
    '68': {
        label: 'Haut-Rhin',
        kind: 'facet',
        // Bornes réelles de la série (246 registres scrapés, voir scrape_successions_multi.py).
        // Portail sans date par item dans la liste de résultats (needs_detail_date) et avec un
        // numéro de page courant absent du texte de pagination statique - voir total_pages().
        minYear: 1832,
        maxYear: 1969,
        portalBase: 'https://archives68.alsace.eu/search/results',
        formUuid: 'e58a19a1-3336-434f-9376-425c8bbb2f11',
        registersUrl: './assets/data/successions_68.json',
        bureauxUrl: './assets/data/successions_68_bureaux.json',
    },
    '13': {
        label: 'Bouches-du-Rhône',
        kind: 'facet',
        // Bornes réelles de la série (2320 registres scrapés, voir
        // scrape_successions_bouches_du_rhone.py) : chaque registre couvre souvent plusieurs
        // communes explicitement nommées (pas seulement le siège du bureau comme ailleurs), d'où
        // 108 communes à correspondance exacte directe - bien plus fin que le simple repli par
        // proximité utilisé pour les 34 communes restantes du département.
        minYear: 1769,
        maxYear: 1925,
        registersUrl: './assets/data/successions_13.json',
        bureauxUrl: './assets/data/successions_13_bureaux.json',
        // Portail "Ligeo Archives" (même logiciel qu'Aveyron/Seine-Maritime/Haute-Garonne), mais
        // avec un formulaire de recherche classique (bureau + case à cocher "Table des décès,
        // successions et absences" explicite) plutôt qu'un arbre de classement ou une autocomplete
        // plafonnée - repli sur le formulaire lui-même.
        catalogUrl: 'https://www.archives13.fr/archive/recherche/enregistrement/n:33',
    },
    '19': {
        label: 'Corrèze',
        kind: 'facet',
        // Bornes réelles de la série (460 registres scrapés, voir scrape_successions_multi.py).
        minYear: 1731,
        maxYear: 1969,
        portalBase: 'https://www.archives.correze.fr/search/results',
        formUuid: '4a09a92a-132c-44a6-aac4-a4f0e5155439',
        registersUrl: './assets/data/successions_19.json',
        bureauxUrl: './assets/data/successions_19_bureaux.json',
    },
    '69': {
        label: 'Rhône',
        kind: 'facet',
        // Bornes réelles de la série (475 registres scrapés, voir scrape_successions_multi.py).
        minYear: 1823,
        maxYear: 1968,
        registersUrl: './assets/data/successions_69.json',
        bureauxUrl: './assets/data/successions_69_bureaux.json',
        // Pas de formUuid publié pour cette série ici (interrogée par mot-clé côté scraper, voir
        // DEPARTMENTS['69'] dans scrape_successions_multi.py) : repli sur cette même recherche.
        catalogUrl: 'https://archives.rhone.fr/search/results?target=controlledAccessPhysicalCharacteristic&keyword=Table+des+successions+et+absences&mode=list&sort=referencecode_asc',
    },
    '27': {
        label: 'Eure',
        kind: 'facet',
        // Bornes réelles de la série (233 registres scrapés, voir scrape_successions_multi.py).
        minYear: 1787,
        maxYear: 1963,
        portalBase: 'https://archives.eure.fr/search/results',
        formUuid: '57bc0059-0ae5-407e-a513-87c35dfe5907',
        registersUrl: './assets/data/successions_27.json',
        bureauxUrl: './assets/data/successions_27_bureaux.json',
    },
    '12': {
        label: 'Aveyron',
        kind: 'facet',
        // Bornes réelles de la série (513 registres scrapés, voir scrape_successions_aveyron.py) :
        // liste des 34 bureaux tirée du PDF officiel du département, l'autocomplete du portail
        // étant plafonnée à 10 suggestions sans lien fiable avec le nom saisi.
        minYear: 1751,
        maxYear: 1968,
        registersUrl: './assets/data/successions_12.json',
        bureauxUrl: './assets/data/successions_12_bureaux.json',
        // Portail "Ligeo Archives" (même logiciel que Seine-Maritime/Haute-Garonne/Bouches-du-Rhône).
        catalogUrl: 'https://archives.aveyron.fr/archive/resultats/tablesuccessions/n:128?type=tablesuccessions',
    },
    '84': {
        label: 'Vaucluse',
        kind: 'facet',
        // Bornes réelles de la série (175 registres scrapés, voir scrape_successions_vaucluse.py) :
        // seuls 7 bureaux (sur l'ensemble historique du département) ont un fonds numérisé et
        // consultable en ligne ici (Avignon, Apt, Pertuis, Vaison-la-Romaine, Valréas,
        // Pernes-les-Fontaines, Sault) - repli par proximité plus grossier qu'ailleurs pour les
        // communes hors de leur ressort (peu de bureaux à répartir sur tout le département).
        minYear: 1741,
        maxYear: 1968,
        registersUrl: './assets/data/successions_84.json',
        bureauxUrl: './assets/data/successions_84_bureaux.json',
        // Portail "Anaphore/Bach" (même logiciel que Tarn/Tarn-et-Garonne/Gard/Côtes-d'Armor).
        catalogUrl: 'https://earchives.vaucluse.fr/archives/search?filter_field=cSubject&filter_value=enregistrement',
    },
};

// "LILLE (1er bureau)" -> "LILLE" : le nom de la ville-siège du bureau, sans le qualificatif
// d'arrondissement/canton — plusieurs libellés du vocabulaire contrôlé partagent souvent la même
// ville-siège (LILLE / LILLE (1er/2e/3e bureau), ROUBAIX / (Ville) / (Canton)...), et un acte
// mentionnant juste "Lille" peut avoir été enregistré dans n'importe lequel des bureaux de Lille
// selon le quartier — impossible à deviner depuis le seul GEDCOM. On regroupe donc tous les
// registres d'une même ville-siège pour proposer TOUTES les pistes plutôt qu'une seule au hasard.
function baseBureauName(place) {
    return place.replace(/\s*\(.*\)\s*$/, '').trim();
}

// Certains portails partagent un même registre entre plusieurs bureaux plutôt qu'un seul par
// registre comme partout ailleurs (ex. Territoire de Belfort : "bureaux de Delle, Fontaine et
// Giromagny") : on indexe alors ce registre sous CHAQUE nom de bureau, sans quoi aucune de ces
// communes ne matcherait jamais exactement. Ne PAS découper "X, La"/"X, Le"/"X, Les" : c'est
// l'article reporté en fin de nom (convention de nommage vue à Loire-Atlantique, ex.
// "Chapelle-sur-Erdre, La"), pas une liste de bureaux.
function bureauNamesFromPlace(place) {
    const base = baseBureauName(place);
    if (/,\s*(la|le|les|l['’])$/i.test(base)) return [base];
    return base.split(/,| et /i).map(s => s.trim()).filter(Boolean);
}

// Lien de repli (Nord) quand aucun registre précis n'a pu être identifié (commune absente du
// dépouillement, y compris via le bureau le plus proche) : liste, pour l'année demandée, tous les
// registres du département sans filtrer par lieu — à feuilleter soi-même plutôt que rien.
function buildYearOnlySearchUrl(config, year) {
    const params = new URLSearchParams();
    params.set('formUuid', config.formUuid);
    params.set('sort', 'referencecode_asc');
    params.set('mode', 'list');
    params.set('facet_media', 'image');
    if (year != null) {
        params.set('1-date_begin', year);
        params.set('1-date_end', year);
    }
    params.set('2-date', '');
    return `${config.portalBase}?${params.toString()}`;
}

// Première lettre du patronyme, normalisée (majuscule, sans accent) pour matcher les tranches
// "Noms commençant par X" des répertoires alphabétiques (voir kind 'bureau-letter') ; null si le
// patronyme est vide ou ne commence pas par une lettre (particule détachée, chiffre...).
function firstSurnameLetter(surname) {
    if (!surname) return null;
    const s = surname.trim();
    if (!s) return null;
    const letter = normalizePlace(s.charAt(0)).toUpperCase();
    return /^[A-Z]$/.test(letter) ? letter : null;
}

const indexPromises = new Map();

function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
}

// kind 'facet' (Nord, Tarn-et-Garonne) : registres groupés par ville-siège de bureau + repli par
// proximité géographique commune -> bureau le plus proche (voir build_successions_*_bureaux.py).
function loadFacetIndex(config) {
    return Promise.all([
        fetchJson(config.registersUrl),
        config.bureauxUrl ? fetchJson(config.bureauxUrl).catch(() => ({})) : Promise.resolve({}),
    ]).then(([registers, bureaux]) => {
        const registerIndex = new Map();
        registers.forEach(r => {
            bureauNamesFromPlace(r.place).forEach(name => {
                const key = normalizePlace(name);
                if (!registerIndex.has(key)) registerIndex.set(key, []);
                registerIndex.get(key).push(r);
            });
        });
        const bureauIndex = new Map();
        Object.entries(bureaux).forEach(([communeNorm, entry]) => {
            bureauIndex.set(normalizePlace(communeNorm), entry);
        });
        return { registerIndex, bureauIndex };
    });
}

// kind 'bureau-letter' (Tarn) : registres groupés par bureau PUIS par initiale de patronyme, et
// vraie table historique commune -> bureau (avec dates de bascule) publiée par le département —
// voir build_successions_tarn_communes.py, pas une approximation contrairement au repli du Nord.
function loadBureauLetterIndex(config) {
    return Promise.all([
        fetchJson(config.registersUrl),
        fetchJson(config.communesUrl).catch(() => ({})),
    ]).then(([registers, communes]) => {
        const registerIndex = new Map(); // bureauNorm -> Map(letter -> records[])
        registers.forEach(r => {
            const bureauKey = normalizePlace(r.bureau);
            if (!registerIndex.has(bureauKey)) registerIndex.set(bureauKey, new Map());
            const byLetter = registerIndex.get(bureauKey);
            if (!byLetter.has(r.letter)) byLetter.set(r.letter, []);
            byLetter.get(r.letter).push(r);
        });
        const communeHistory = new Map();
        Object.entries(communes).forEach(([communeNorm, history]) => {
            communeHistory.set(normalizePlace(communeNorm), history);
        });
        return { registerIndex, communeHistory };
    });
}

// kind 'citywide' (Paris) : pas de correspondance commune -> bureau (une seule commune dans tout
// le département) - un seul tableau plat de tous les registres, filtré par année à la résolution.
function loadCitywideIndex(config) {
    return fetchJson(config.registersUrl).then(records => ({ records }));
}

// Charge et indexe, pour un département donné, les données précalculées par son scraper. Un échec
// réseau n'est pas fatal : le département retombe simplement sur "aucune piste" plutôt que de
// bloquer toute l'analyse.
function loadDeptIndex(deptCodeKey) {
    const config = SUCCESSION_DEPTS[deptCodeKey];
    const loader = config.kind === 'bureau-letter' ? loadBureauLetterIndex
        : config.kind === 'citywide' ? loadCitywideIndex
        : loadFacetIndex;
    return loader(config)
        .then(idx => ({ config, ...idx }))
        .catch(err => {
            console.error(`Chargement des successions (dept ${deptCodeKey}) échoué:`, err);
            return { config, registerIndex: new Map(), bureauIndex: new Map(), communeHistory: new Map(), records: [] };
        });
}

// Démarre le chargement de tous les départements couverts dès l'import du module (voir
// loadNotairesIndex dans notaires.js pour le même principe) : un échec partiel n'empêche pas les
// autres départements de fonctionner.
export function loadSuccessionIndexes() {
    return Promise.all(
        Object.keys(SUCCESSION_DEPTS).map(dc => {
            if (!indexPromises.has(dc)) indexPromises.set(dc, loadDeptIndex(dc));
            return indexPromises.get(dc).then(idx => [dc, idx]);
        })
    ).then(entries => new Map(entries));
}

// Parmi les registres candidats (déjà filtrés sur la bonne ville-siège / le bon bureau+lettre),
// renvoie ceux dont la période couvre l'année recherchée (il peut y en avoir plusieurs : bureaux
// multiples d'une même ville, périodes redondantes/qui se chevauchent...) ; à défaut, le registre
// le plus proche dans le temps, pour ne jamais renvoyer une piste vide quand des registres
// existent bel et bien pour cette commune, juste pas pile sur cette année (bornes de registre
// imprécises, calendrier républicain converti approximativement).
function pickRegisters(records, year) {
    if (!records || !records.length) return [];
    const containing = records.filter(r => year >= r.yearStart && year <= r.yearEnd);
    if (containing.length) return containing;
    let best = records[0], bestDist = Infinity;
    records.forEach(r => {
        const dist = year < r.yearStart ? r.yearStart - year : year - r.yearEnd;
        if (dist < bestDist) { bestDist = dist; best = r; }
    });
    return [best];
}

function resolveFacet(idx, geo, year) {
    const cityNorm = normalizePlace(geo.city);
    const exact = idx.registerIndex.get(cityNorm);
    if (exact && exact.length) {
        return { matchType: 'exact', registers: pickRegisters(exact, year), bureauInfo: null, contextLabel: null };
    }
    const bureauInfo = idx.bureauIndex.get(cityNorm) || null;
    const viaBureau = bureauInfo ? idx.registerIndex.get(normalizePlace(bureauInfo.bureau)) : null;
    if (viaBureau && viaBureau.length) {
        return { matchType: 'bureau', registers: pickRegisters(viaBureau, year), bureauInfo, contextLabel: null };
    }
    return { matchType: 'none', registers: [], bureauInfo: null, contextLabel: null };
}

function resolveBureauLetter(idx, geo, year, person) {
    const cityNorm = normalizePlace(geo.city);
    const history = idx.communeHistory.get(cityNorm);
    const bureau = history ? (history.find(h => year >= h.yearStart && year <= h.yearEnd) || {}).bureau : null;
    if (!bureau) {
        return { matchType: 'none', registers: [], bureauInfo: null, contextLabel: null };
    }
    const letter = firstSurnameLetter(person.surname);
    const byLetter = idx.registerIndex.get(normalizePlace(bureau));
    const candidates = letter && byLetter ? byLetter.get(letter) : null;
    if (candidates && candidates.length) {
        return {
            matchType: 'exact', registers: pickRegisters(candidates, year), bureauInfo: null,
            contextLabel: `Bureau de ${bureau} — noms commençant par ${letter}`,
        };
    }
    return {
        matchType: 'none', registers: [], bureauInfo: null,
        contextLabel: letter ? `Bureau de ${bureau} (aucun registre pour "${letter}")` : `Bureau de ${bureau} (patronyme inconnu)`,
    };
}

// Préfixe normalisé (majuscules, sans accents) du patronyme, tronqué à la longueur voulue - même
// normalisation que firstSurnameLetter, étendue aux tokens multi-caractères (subdivisions fines
// par syllabe, ex. "Sav à Sig") que publie la table parisienne (voir parse_letter_filter côté
// scraper, scrape_successions_paris.py).
function surnamePrefix(surname, len) {
    if (!surname) return '';
    return normalizePlace(surname).toUpperCase().trim().slice(0, len);
}

// r.letterFilter (voir scrape_successions_paris.py/parse_letter_filter) : null si le registre
// couvre tout l'alphabet ou si le texte source n'a pas pu être découpé de façon fiable - dans ce
// cas on ne filtre PAS (mieux vaut montrer une piste en trop que masquer à tort une vraie
// correspondance, cf. le commentaire du scraper).
function matchesLetterFilter(filter, surname) {
    if (!filter) return true;
    if (filter.mode === 'set') {
        return filter.tokens.some(t => surnamePrefix(surname, t.length) === t);
    }
    const len = Math.max(filter.from.length, filter.to.length);
    const prefix = surnamePrefix(surname, len).padEnd(len, ' ');
    return prefix >= filter.from.padEnd(len, ' ') && prefix <= filter.to.padEnd(len, ' ');
}

// kind 'citywide' (Paris) : aucune correspondance de lieu à faire (une seule commune dans tout le
// département), mais chaque registre couvre une tranche de patronymes (comme au Tarn, voir kind
// 'bureau-letter') ET un arrondissement/bureau particulier - sans le filtre par patronyme, une
// recherche par année seule renvoie des dizaines de registres (tous les bureaux ET toutes les
// tranches de lettres actifs cette année-là). Il reste malgré tout possible d'avoir plusieurs
// candidats après filtrage : l'arrondissement du décès (que le GEDCOM ne connaît généralement pas)
// départagerait, d'où le contextLabel qui prévient de vérifier soi-même dans ce cas.
function resolveCitywide(idx, year, person) {
    const bySurname = idx.records.filter(r => matchesLetterFilter(r.letterFilter, person.surname));
    const registers = pickRegisters(bySurname, year);
    if (!registers.length) {
        return { matchType: 'none', registers: [], bureauInfo: null, contextLabel: null };
    }
    const places = new Set(registers.map(r => r.place));
    return {
        matchType: 'exact', registers, bureauInfo: null,
        contextLabel: places.size > 1
            ? `Paris est organisé par arrondissement : ${registers.length} registre(s) correspondent à cette année, à vérifier selon l'arrondissement du décès.`
            : null,
    };
}

// Seul le décès donne lieu à une déclaration de succession (contrairement au notariat, un mariage
// n'en produit pas) : uniquement l'événement DEAT est considéré ici.
// indexes: Map département -> {config, ...} (voir loadSuccessionIndexes)
// opts: { ancestorScopeSet }
export function computeSuccessionLeads(list, indexes, opts) {
    opts = opts || {};
    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;
        const year = p.death?.year;
        const geo = p.death?.geo;
        if (year == null || !geo || !geo.city || !geo.dept) return;

        const dc = deptCode(geo.dept);
        const idx = indexes.get(dc);
        if (!idx) return; // département non couvert par ce module
        const { config } = idx;
        if (year < config.minYear || year > config.maxYear) return; // hors des bornes de la série

        const resolved = config.kind === 'bureau-letter' ? resolveBureauLetter(idx, geo, year, p)
            : config.kind === 'citywide' ? resolveCitywide(idx, year, p)
            : resolveFacet(idx, geo, year);

        results.push({
            person: p, year, city: geo.city, dept: dc, deptLabel: config.label,
            ...resolved,
            // Le repli dépend de ce que le portail sait faire, pas de la mécanique de
            // correspondance (kind) : formUuid signale un portail à recherche par facettes
            // (Nord — peut filtrer par année seule), les autres sont des arbres de classement
            // (Tarn, Tarn-et-Garonne — repli sur la page de la série entière, catalogUrl).
            fallbackUrl: resolved.registers.length ? null
                : (config.formUuid ? buildYearOnlySearchUrl(config, year) : config.catalogUrl),
        });
    });
    return results;
}
