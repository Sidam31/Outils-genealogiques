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
        // Bornes réelles de la série (1105 registres scrapés, voir scrape_successions_multi.py -
        // dont les bureaux propres à Lyon, longtemps absents faute de LYON_BUREAU_RE).
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
    '21': {
        label: "Côte-d'Or",
        kind: 'facet',
        // Bornes réelles de la série (477 registres scrapés, voir
        // scrape_successions_cote_dor.py).
        minYear: 1809,
        maxYear: 1969,
        registersUrl: './assets/data/successions_21.json',
        bureauxUrl: './assets/data/successions_21_bureaux.json',
        // Septième logiciel : ancien "console/ir_ead_*" (finding-aid Archinoë), avec des liens de
        // visionneuse indépendants de toute session contrairement à son cousin (voir le scraper).
        catalogUrl: 'https://archives.cotedor.fr/console/ir_ead_visu.php?eadid=FRAD021_000001842&ir=23254',
    },
    '73': {
        label: 'Savoie',
        kind: 'facet',
        // Bornes réelles de la série (168 registres scrapés, voir scrape_successions_savoie.py) :
        // 21 des 25 bureaux ont un fonds catalogué sous ce type exact ("Tables des décès,
        // successions et absences") ; les 4 restants (Ugine, La Chambre,
        // Saint-Michel-de-Maurienne, Yenne) n'en ont pas dans ce catalogue en ligne - repli par
        // proximité pour leurs communes.
        minYear: 1858,
        maxYear: 1968,
        registersUrl: './assets/data/successions_73.json',
        bureauxUrl: './assets/data/successions_73_bureaux.json',
        // Portail "Mnesys" (huitième logiciel) : liens de visionneuse "ark:" indépendants de toute
        // session, contrairement à son cousin apparent qui a bloqué la Charente-Maritime.
        catalogUrl: 'https://recherche-archives.savoie.fr/?id=search1398427899lBzVcZ',
    },
    '62': {
        label: 'Pas-de-Calais',
        kind: 'facet',
        // Bornes réelles de la série (940 registres scrapés, voir
        // scrape_successions_pas_de_calais.py). 38 des 40 bureaux du formulaire ont un fonds
        // "Table des successions et absences" catalogué ; Aire-sur-la-Lys et Frévent n'ont que des
        // "Tables des successions acquittées" (type exclu, comme ailleurs dans ce projet) - repli
        // par proximité pour leurs communes. Desvres n'a pas de bureau dans le formulaire du tout
        // (numérisation annoncée "à venir" par le site source lui-même).
        minYear: 1791,
        maxYear: 1968,
        registersUrl: './assets/data/successions_62.json',
        bureauxUrl: './assets/data/successions_62_bureaux.json',
        // Portail protégé par Incapsula, contourné avec l'autorisation explicite du service
        // d'archives du Pas-de-Calais (même précédent que la Haute-Garonne).
        catalogUrl: 'https://archivesenligne.pasdecalais.fr/console/ir_seriel.php?id=56&p=formulaire_enregistrement_tsa',
    },
    '91': {
        label: 'Essonne',
        kind: 'facet',
        // Bornes réelles de la série (263 registres scrapés, voir scrape_successions_multi.py,
        // DEPARTMENTS['91']) : seuls 12 des bureaux d'enregistrement du département ont un fonds
        // "Tables des successions" numérisé sous ce formUuid - repli par proximité pour le reste.
        minYear: 1780,
        maxYear: 1977,
        registersUrl: './assets/data/successions_91.json',
        bureauxUrl: './assets/data/successions_91_bureaux.json',
        catalogUrl: 'https://archives.essonne.fr/page/successions-1',
    },
    '01': {
        label: 'Ain',
        kind: 'facet',
        // Bornes réelles de la série (362 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py) : neuvième logiciel du projet mais même famille que
        // la Haute-Garonne (Ligeo Archives), ici en mode liste plate (pas d'arborescence) - portail
        // protégé par Anubis, contourné avec l'autorisation explicite du service d'archives.
        minYear: 1834,
        maxYear: 1969,
        registersUrl: './assets/data/successions_01.json',
        bureauxUrl: './assets/data/successions_01_bureaux.json',
        catalogUrl: 'https://www.archives.ain.fr/archive/recherche/3q/n:92',
    },
    '16': {
        label: 'Charente',
        kind: 'facet',
        // Bornes réelles de la série (296 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['16']) : même logiciel/même Anubis que
        // l'Ain, mais en mode "typefilter" (le fonds "Enregistrement" mélange sommiers, tables des
        // vendeurs/acquéreurs/sépultures... - un facet "Table de successions et absences" isole
        // la bonne sous-série côté serveur, avec cote officielle réelle cette fois).
        minYear: 1849,
        maxYear: 1970,
        registersUrl: './assets/data/successions_16.json',
        bureauxUrl: './assets/data/successions_16_bureaux.json',
        catalogUrl: 'https://lasource.archives.lacharente.fr/archive/recherche/enregistrement/n:127',
    },
    '02': {
        label: 'Aisne',
        kind: 'facet',
        // Bornes réelles de la série (309 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['02']) : troisième mise en page de
        // résultats rencontrée sur ce même logiciel (une "carte" par ligne au lieu de colonnes),
        // avec deux registres sans dates en calendrier grégorien (uniquement "an II-an VIII") -
        // convertis par approximation (voir REPUBLICAN_RE dans le scraper).
        minYear: 1793,
        maxYear: 1970,
        registersUrl: './assets/data/successions_02.json',
        bureauxUrl: './assets/data/successions_02_bureaux.json',
        catalogUrl: 'https://archives.aisne.fr/archive/recherche/successionsabsences/n:322',
    },
    '42': {
        label: 'Loire',
        kind: 'facet',
        // Bornes réelles de la série (628 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['42']) : recherche vide couvrant tout le
        // fonds "Enregistrement" (donations, sépultures, testaments, successions ACQUITTÉES...),
        // filtré côté client sur le titre de la visionneuse (aucun champ de formulaire dédié ici).
        minYear: 1823,
        maxYear: 1968,
        registersUrl: './assets/data/successions_42.json',
        bureauxUrl: './assets/data/successions_42_bureaux.json',
        catalogUrl: 'https://archives.loire.fr/archive/recherche/enregistrement/n:130',
    },
    '93': {
        label: 'Seine-Saint-Denis',
        kind: 'facet',
        // Bornes réelles de la série (719 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['93']) : 9 des 10 bureaux (Aulnay-sous-
        // Bois sans résultat sur ce fonds) - recherche vide sans résultat, contrairement à l'Ain.
        minYear: 1705,
        maxYear: 1983,
        registersUrl: './assets/data/successions_93.json',
        bureauxUrl: './assets/data/successions_93_bureaux.json',
        catalogUrl: 'https://archives.seinesaintdenis.fr/archive/recherche/sucession/n:219',
    },
    '07': {
        label: 'Ardèche',
        kind: 'facet',
        // Bornes réelles de la série (9985 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['07']) : recherche vide déjà scopée aux
        // successions (pas de filtrage nécessaire), mais chaque bureau y est subdivisé par lettre
        // de patronyme (comme au Tarn/Paris), d'où un volume de registres bien plus élevé qu'aux
        // autres départements de cette famille.
        minYear: 1738,
        maxYear: 1970,
        registersUrl: './assets/data/successions_07.json',
        bureauxUrl: './assets/data/successions_07_bureaux.json',
        catalogUrl: 'https://archives.ardeche.fr/archive/recherche/enrmoderne/n:203',
    },
    '67': {
        label: 'Bas-Rhin',
        kind: 'facet',
        // Bornes réelles de la série (627 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['67']) : fonds déjà scopé aux "Tables
        // alphabétiques des successions et absences", recherche par bureau obligatoire (30 bureaux).
        minYear: 1801,
        maxYear: 1974,
        registersUrl: './assets/data/successions_67.json',
        bureauxUrl: './assets/data/successions_67_bureaux.json',
        catalogUrl: 'https://archives67.alsace.eu/archive/recherche/enregistrement/n:146',
    },
    '70': {
        label: 'Haute-Saône',
        kind: 'facet',
        // Bornes réelles de la série (363 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['70']) : pas de colonne de type, une
        // seule cellule descriptive par ligne ("Bureau d'Amance.- Table des successions et
        // absences : ...") sert de filtre ET de source lieu/date/cote-de-bureau (l'ID du fonds du
        // candidat initial, n:123, était périmé - le bon (n:121) trouvé via le menu du site).
        minYear: 1786,
        maxYear: 1969,
        registersUrl: './assets/data/successions_70.json',
        bureauxUrl: './assets/data/successions_70_bureaux.json',
        catalogUrl: 'https://archives.haute-saone.fr/archive/recherche/enregistrement/n:121',
    },
    '33': {
        label: 'Gironde',
        kind: 'facet',
        // Bornes réelles de la série (582 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['33']) : recherche filtrée par facette
        // REch_table (comme la Charente), mais nécessite un segment d'URL "/tableau/" avant
        // "limit:50"/"page:N" propre à ce déploiement, et une détection de recyclage de page (le
        // site renvoie le contenu de la page 1 au lieu d'une page vide passé la vraie dernière
        // page - repéré après ~120 pages inutiles avant correction, voir scrape_department).
        minYear: 1815,
        maxYear: 1949,
        registersUrl: './assets/data/successions_33.json',
        bureauxUrl: './assets/data/successions_33_bureaux.json',
        catalogUrl: 'https://archives.gironde.fr/archive/recherche/enregistrement2',
    },
    '74': {
        label: 'Haute-Savoie',
        kind: 'facet',
        // Bornes réelles de la série (299 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['74']) : champ <select> propre "Table des
        // successions et absences", pas de facette à découvrir. Un bureau (Carouge) est en réalité
        // suisse (canton de Genève) - hors de communes_geo/74.json, sans repli par proximité pour
        // les communes environnantes mais son propre registre reste trouvé normalement.
        minYear: 1793,
        maxYear: 1968,
        registersUrl: './assets/data/successions_74.json',
        bureauxUrl: './assets/data/successions_74_bureaux.json',
        catalogUrl: 'https://archives.hautesavoie.fr/archive/recherche/enregistrement/n:154',
    },
    '92': {
        label: 'Hauts-de-Seine',
        kind: 'facet',
        // Bornes réelles de la série (559 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['92']) : facette REch_TYPE isolant
        // "Tables des successions et absences" du fonds "Enregistrements" (qui mélange aussi des
        // déclarations de successions individuelles, un fonds voisin mais distinct).
        minYear: 1807,
        maxYear: 1969,
        registersUrl: './assets/data/successions_92.json',
        bureauxUrl: './assets/data/successions_92_bureaux.json',
        catalogUrl: 'https://archives.hauts-de-seine.fr/archive/recherche/enregistrements/n:96',
    },
    '86': {
        label: 'Vienne',
        kind: 'facet',
        // Bornes réelles de la série (524 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['86']) : portail commun aux Deux-Sèvres/
        // Vienne, séparés via un filtre RECH_dep en plus du type ("table de successions"). Certaines
        // lignes insèrent une annotation optionnelle ("Paroisses de...") qui décale les colonnes -
        // date lue à l'avant-avant-dernière cellule plutôt qu'à un indice fixe (voir columns dans
        // le scraper).
        minYear: 1719,
        maxYear: 1968,
        registersUrl: './assets/data/successions_86.json',
        bureauxUrl: './assets/data/successions_86_bureaux.json',
        catalogUrl: 'https://archives-deux-sevres-vienne.fr/archive/recherche/enregistrement/n:101',
    },
    '79': {
        label: 'Deux-Sèvres',
        kind: 'facet',
        // Bornes réelles de la série (554 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['79']) : même portail commun que la
        // Vienne (voir ce commentaire), filtré sur ce département via RECH_dep.
        minYear: 1710,
        maxYear: 1969,
        registersUrl: './assets/data/successions_79.json',
        bureauxUrl: './assets/data/successions_79_bureaux.json',
        catalogUrl: 'https://archives-deux-sevres-vienne.fr/archive/recherche/enregistrement/n:101',
    },
    '89': {
        label: 'Yonne',
        kind: 'facet',
        // Bornes réelles de la série (408 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['89']) : dixième mise en page rencontrée
        // sur ce logiciel (un <h3> composite par registre, "cote * volume - dates - Bureau de
        // l'enregistrement d'X / ..."), et seul département de cette famille où chaque bureau a son
        // PROPRE segment d'URL (fonds_id) plutôt qu'un simple paramètre de requête partagé.
        minYear: 1809,
        maxYear: 1968,
        registersUrl: './assets/data/successions_89.json',
        bureauxUrl: './assets/data/successions_89_bureaux.json',
        catalogUrl: 'https://archives.yonne.fr/archive/recherche/enregistrement/n:406',
    },
    '63': {
        label: 'Puy-de-Dôme',
        kind: 'facet',
        // Bornes réelles de la série (598 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['63']) : case à cocher propre
        // "successions et absences" couvrant tous les bureaux en une seule recherche.
        minYear: 1807,
        maxYear: 1970,
        registersUrl: './assets/data/successions_63.json',
        bureauxUrl: './assets/data/successions_63_bureaux.json',
        catalogUrl: 'https://www.archivesdepartementales.puy-de-dome.fr/archive/recherche/enregistrement/',
    },
    '48': {
        label: 'Lozère',
        kind: 'facet',
        // Bornes réelles de la série (76 registres scrapés, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['48']) : seul département de cette
        // famille dont l'arbre entier (dossiers ET feuilles) est déjà rendu en une seule page
        // (pas de requête par noeud comme la Haute-Garonne) - avec un piège de classification par
        // héritage (voir walk_tree dans le scraper) : un dossier nommé "successions et absences"
        // peut englober à la fois cette série ET son antécédent "acquittées" (pré-1825), chaque
        // feuille portant alors sa propre classification plus précise qui prime sur celle héritée
        // du parent. Seuls 8 bureaux ressortent avec cette classification résolue correctement.
        minYear: 1816,
        maxYear: 1969,
        registersUrl: './assets/data/successions_48.json',
        bureauxUrl: './assets/data/successions_48_bureaux.json',
        catalogUrl: 'https://archives.lozere.fr/archive/recherche/enregistrement/n:305',
    },
    '15': {
        label: 'Cantal',
        kind: 'facet',
        // Bornes réelles de la série (274 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['15']) : onzième logiciel du projet mais
        // même famille "Arkothèque" que l'Allier/Paris - portail protégé par un mur anti-robot à
        // redirection cookie, contourné avec l'autorisation explicite du service d'archives (même
        // précédent que la Haute-Garonne/le Pas-de-Calais). Page dédiée "...-numerisees" utilisée
        // plutôt que la page "Enregistrement" générale, qui mélange plusieurs séries distinctes.
        minYear: 1757,
        maxYear: 1968,
        registersUrl: './assets/data/successions_15.json',
        bureauxUrl: './assets/data/successions_15_bureaux.json',
        catalogUrl: 'https://archives.cantal.fr/rechercher/genealogie/tables-des-successions-et-absences-numerisees',
    },
    '94': {
        label: 'Val-de-Marne',
        kind: 'facet',
        // Bornes réelles de la série (719 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['94']) : page dédiée, déjà scopée aux deux
        // variantes voulues ("Tables des successions et absences" / "Tables des décès, successions
        // et absences") - confirmé sans mélange d'autre sous-série avant de s'en servir tel quel.
        minYear: 1759,
        maxYear: 1975,
        registersUrl: './assets/data/successions_94.json',
        bureauxUrl: './assets/data/successions_94_bureaux.json',
        catalogUrl: 'https://archives.valdemarne.fr/recherches/archives-en-ligne/tables-alphabetiques-de-successions',
    },
    '87': {
        label: 'Haute-Vienne',
        kind: 'facet',
        // Bornes réelles de la série (416 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['87']) : page mélangeant "Déclarations de
        // successions" (dépôts bruts, non voulus) et "Table des successions et absences" (la vraie
        // table), filtrée côté client sur le champ "analyse".
        minYear: 1790,
        maxYear: 1968,
        registersUrl: './assets/data/successions_87.json',
        bureauxUrl: './assets/data/successions_87_bureaux.json',
        catalogUrl: 'https://archives.haute-vienne.fr/rechercher/archives-en-ligne/declarations-et-tables-des-successions-1790-1968',
    },
    '08': {
        label: 'Ardennes',
        kind: 'facet',
        // Bornes réelles de la série (174 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['08']) : page dédiée déjà propre, aucun
        // filtrage nécessaire.
        minYear: 1768,
        maxYear: 1958,
        registersUrl: './assets/data/successions_08.json',
        bureauxUrl: './assets/data/successions_08_bureaux.json',
        catalogUrl: 'https://archives.cd08.fr/archives-numerisees/sources-genealogiques/tables-des-successions-et-absences',
    },
    '18': {
        label: 'Cher',
        kind: 'facet',
        // Bornes réelles de la série (363 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['18']) : mélange "Table(s) des successions
        // et (des) absences" avec "Table des sépultures et décès" (sous-série voisine, non voulue)
        // - filtré côté client sur le champ de type.
        minYear: 1797,
        maxYear: 1968,
        registersUrl: './assets/data/successions_18.json',
        bureauxUrl: './assets/data/successions_18_bureaux.json',
        catalogUrl: 'https://www.archives18.fr/archives-numerisees/tables-de-successions-et-dabsences',
    },
    '49': {
        label: 'Maine-et-Loire',
        kind: 'facet',
        // Bornes réelles de la série (593 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['49']) : mélange "Table des décès"/"Table
        // des successions acquittées" (exclue) avec "Table des successions et absences" (voulue) -
        // filtré côté client. Aucune cote officielle exposée sur ce déploiement.
        minYear: 1822,
        maxYear: 1968,
        registersUrl: './assets/data/successions_49.json',
        bureauxUrl: './assets/data/successions_49_bureaux.json',
        catalogUrl: 'https://recherche-archives.maine-et-loire.fr/rechercher-et-consulter/archives-consultables-en-ligne/tables-de-successions-et-absences',
    },
    '72': {
        label: 'Sarthe',
        kind: 'facet',
        // Bornes réelles de la série (503 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['72']) : mélange "Table des contrats de
        // mariage"/"Table des successions acquittées" (exclue) avec "Table des successions et
        // absences" (voulue) - filtré côté client.
        minYear: 1824,
        maxYear: 1971,
        registersUrl: './assets/data/successions_72.json',
        bureauxUrl: './assets/data/successions_72_bureaux.json',
        catalogUrl: 'https://archives.sarthe.fr/archives-en-ligne/tables-de-lenregistrement-sous-serie-3-q',
    },
    '10': {
        label: 'Aube',
        kind: 'facet',
        // Bornes réelles de la série (249 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['10']) : page dédiée déjà propre, aucun
        // filtrage nécessaire.
        minYear: 1790,
        maxYear: 1946,
        registersUrl: './assets/data/successions_10.json',
        bureauxUrl: './assets/data/successions_10_bureaux.json',
        catalogUrl: 'https://www.archives-aube.fr/recherches/documents-numerises/genealogie/tables-de-successions/tables-des-successions-et-absences-1790-1946',
    },
    '78': {
        label: 'Yvelines',
        kind: 'facet',
        // Bornes réelles de la série (287 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['78']) : fonds "9Q Enregistrement" complet
        // (13 types distincts : acquéreurs, baux, contrats de mariage, décès et absences par
        // jugement, partages, successions acquittées/payées, testaments...) - filtré côté client
        // sur le seul "Tables des successions et absences" (correspondance exacte).
        minYear: 1824,
        maxYear: 1969,
        registersUrl: './assets/data/successions_78.json',
        bureauxUrl: './assets/data/successions_78_bureaux.json',
        catalogUrl: 'https://archives.yvelines.fr/rechercher/archives-en-ligne/enregistrementbrtables-referencant-les-actesbret-declarations-de-successions/tables-de-lenregistrement',
    },
    '65': {
        label: 'Hautes-Pyrénées',
        kind: 'facet',
        // Bornes réelles de la série (270 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['65']) : mélange avec des "Fiches décès du
        // bureau de X (lettres...)" - un fichier-carte distinct, non voulu - filtré côté client.
        minYear: 1815,
        maxYear: 1970,
        registersUrl: './assets/data/successions_65.json',
        bureauxUrl: './assets/data/successions_65_bureaux.json',
        catalogUrl: 'https://archivesenligne65.fr/archives/acces-thematique/naitre-vivre-et-mourir/les-registres-de-lenregistrement-1',
    },
    '46': {
        label: 'Lot',
        kind: 'facet',
        // Bornes réelles de la série (5570 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['46']) : chaque registre y est subdivisé
        // par lettre de patronyme individuelle (pas une tranche), d'où le volume bien plus élevé
        // que les autres départements de ce projet.
        minYear: 1822,
        maxYear: 1956,
        registersUrl: './assets/data/successions_46.json',
        bureauxUrl: './assets/data/successions_46_bureaux.json',
        catalogUrl: 'https://archives.lot.fr/recherche-en-ligne/archives-numerisees/enregistrement-et-hypotheques/enregistrement-tsa',
    },
    '43': {
        label: 'Haute-Loire',
        kind: 'facet',
        // Bornes réelles de la série (308 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['43']) : fonds "Contrôle des actes et de
        // l'Enregistrement" complet (16 types distincts), filtré côté client sur le seul "Table
        // des successions et absences" (match exact).
        minYear: 1821,
        maxYear: 1968,
        registersUrl: './assets/data/successions_43.json',
        bureauxUrl: './assets/data/successions_43_bureaux.json',
        catalogUrl: 'https://www.archives43.fr/archives-en-ligne/familles-et-individus-en-haute-loire/tables-du-controle-des-actes-et-de-lenregistrement',
    },
    '45': {
        label: 'Loiret',
        kind: 'facet',
        // Bornes réelles de la série (185 registres scrapés, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['45']) : page dédiée propre - les entrées
        // sans visionneuse (registre catalogué mais non numérisé) sont naturellement exclues.
        minYear: 1823,
        maxYear: 1903,
        registersUrl: './assets/data/successions_45.json',
        bureauxUrl: './assets/data/successions_45_bureaux.json',
        catalogUrl: 'https://www.archives-loiret.fr/faire-vos-recherches/archives-numerisees/tables-de-successions',
    },
    '83': {
        label: 'Var',
        kind: 'facet',
        // Bornes réelles de la série (3509 registres, 151 lieux, voir
        // scrape_successions_var_api.py) : le portail plafonne toute recherche à ~10 000 résultats
        // bruts (sur ~17 400 au total tous types confondus), initialement contourné en filtrant
        // uniquement par type (2223 registres) - désormais dépouillé lettre par lettre via le champ
        // "Commune" du widget (caché en display:none mais toujours fonctionnel en déclenchant ses
        // évènements input/change par JS - la seule interaction qui échoue est le clic direct sur
        // son bouton "Consulter la liste"), chaque lettre restant largement sous le plafond (max
        // observé : 4063 fiches brutes pour "L").
        minYear: 1770,
        maxYear: 1975,
        registersUrl: './assets/data/successions_83.json',
        catalogUrl: 'https://archives.var.fr/recherche/rechercher-dans-les-archives-numerisees-et-les-inventaires/controle-des-actes-et-enregistrement',
    },
    '32': {
        label: 'Gers',
        kind: 'facet',
        // Bornes réelles de la série (291 registres, 27 bureaux, voir scrape_successions_gers.py) -
        // nouveau département pour ce projet, outil de recherche maison (pas un des logiciels
        // vendeurs déjà vus ailleurs). Tous les registres portent un lien vers une visionneuse
        // (aucune ligne sans "digitized" constatée) - pas de repli catalogue nécessaire.
        minYear: 1820,
        maxYear: 1968,
        registersUrl: './assets/data/successions_32.json',
        catalogUrl: 'https://www.archives32.fr/archives_numerisees/portail/successions_absences/recherche/',
    },
    '54': {
        label: 'Meurthe-et-Moselle',
        kind: 'facet',
        // Bornes réelles de la série (5741 registres, 557 communes, voir
        // scrape_successions_arkotheque.py, DEPARTMENTS['54']) - portail Arkothèque, nouveau
        // département pour ce projet. Le champ "commune" donne directement la commune exacte (pas
        // juste le bureau), correspondance plus précise que la plupart des autres départements.
        minYear: 1844,
        maxYear: 1945,
        registersUrl: './assets/data/successions_54.json',
        catalogUrl: 'https://archivesenligne.meurthe-et-moselle.fr/archives-en-ligne/tables-de-successions-et-absences',
    },
    '41': {
        label: 'Loir-et-Cher',
        kind: 'facet',
        // Bornes réelles de la série (300 registres, 27 lieux, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['41']) - nouveau département pour ce
        // projet, portail Ligeo Archives derrière Anubis (mode "columns_typefilter", nouveau : le
        // noeud "tsa" mélange 6 types de tables voisines, filtré côté client). Tous les registres
        // sont numérisés.
        minYear: 1824,
        maxYear: 1968,
        registersUrl: './assets/data/successions_41.json',
        catalogUrl: 'https://www.archives41.fr/archive/recherche/tsa/n:152',
    },
    '52': {
        label: 'Haute-Marne',
        kind: 'facet',
        // Bornes réelles de la série (168 registres, 30 bureaux sur 36, voir
        // scrape_successions_haute_marne.py) - nouveau département pour ce projet, portail
        // Anaphore/Bach (même logiciel que Gard/Côtes-d'Armor/Vaucluse) mais arbre à un niveau de
        // plus (volume daté puis subdivision par lettre, non exploitée ici).
        minYear: 1791,
        maxYear: 1966,
        registersUrl: './assets/data/successions_52.json',
        catalogUrl: 'https://archives.haute-marne.fr/archives/classification-scheme',
    },
    '39': {
        label: 'Jura',
        kind: 'facet',
        // Bornes réelles de la série (4 registres seulement, 2 lieux, voir
        // scrape_successions_multi.py DEPARTMENTS['39']) - même logiciel que Nord/Rhône. Le
        // mot-clé "table des successions" est très restrictif sur ce déploiement : la plupart des
        // bureaux n'ont que des "tables des successions collatérales" (sous-série distincte,
        // exclue comme partout ailleurs dans ce projet) - couverture minime mais réelle.
        minYear: 1736,
        maxYear: 1810,
        registersUrl: './assets/data/successions_39.json',
        catalogUrl: 'https://archives39.fr/search/results?target=controlledAccessPhysicalCharacteristic&keyword=table%20des%20successions',
    },
    '88': {
        label: 'Vosges',
        kind: 'facet',
        // Bornes réelles de la série (435 registres, 29 lieux sur 43 bureaux, voir
        // scrape_successions_vosges.py) - nouveau département pour ce projet, portail Ligeo
        // Archives à arbre "tv:/view:" (pas de recherche par facette) débloqué via des liens ARK
        // fournis par l'utilisateur. 2 bureaux (Ruppes, Saulxures-lès-Bulgnéville) n'ont vraiment
        // aucune sous-série de tables dans leur arbre (vérifié en direct : leur seul enfant est
        // "Actes civils publics", pas un problème de scraping) - probablement rattachés très tôt à
        // un bureau voisin. Un 3e bureau à catalogue plus mince (Vrécourt, "Tables" au lieu de
        // "Tables et fichiers") a nécessité un repli d'intitulé, ajouté après coup.
        minYear: 1784,
        maxYear: 1971,
        registersUrl: './assets/data/successions_88.json',
        catalogUrl: 'https://recherche-archives.vosges.fr/archive/fonds/FRAD088_3QW/view:23103',
    },
    '34': {
        label: 'Hérault',
        kind: 'facet',
        // Bornes réelles de la série (575 registres, 32 lieux, voir
        // scrape_successions_ligeo_anubis.py, DEPARTMENTS['34']) - nouveau département pour ce
        // projet, découvert par audit systématique des empreintes logicielles (Ligeo Archives +
        // Anubis). 573/575 registres numérisés.
        minYear: 1760,
        maxYear: 1968,
        registersUrl: './assets/data/successions_34.json',
        catalogUrl: 'https://archives-pierresvives.herault.fr/archive/resultats/enregistrement/n:22',
    },
    '57': {
        label: 'Moselle',
        kind: 'facet',
        // Bornes réelles de la série (620 registres, 34 lieux — tous les bureaux, voir
        // scrape_successions_moselle.py) - nouveau département pour ce projet, découvert par audit
        // systématique. Contrairement à tous les autres départements Ligeo Archives couverts, ce
        // portail ne publie AUCUN tableau HTML par registre pour cette série : seul un PDF officiel
        // par bureau (instrument de recherche complet) est disponible, parsé directement (pas de
        // lien vers une image numérisée par registre, donc "digitized" toujours faux). Deux gabarits
        // de PDF coexistent (le second, plus ancien, utilisé par Metz/Sarreguemines/Vic-sur-Seille,
        // numérote chaque registre par un simple "N*" local plutôt que par le préfixe complet
        // "3Qn/m" - voir extract_records_starred) ; Rombas nomme sa table "Tables des décès" plutôt
        // que "successions et absences" (repli HEADING_DECES_FALLBACK_RE, activé seulement quand
        // aucune vraie section "successions" n'existe par ailleurs dans le même PDF).
        minYear: 1825,
        maxYear: 1969,
        registersUrl: './assets/data/successions_57.json',
        catalogUrl: 'https://www.archives57.com/archive/fonds/FRAD057_archives57-inventaires-bis/view:448878/n:87',
    },
    '14': {
        label: 'Calvados',
        kind: 'facet',
        // Bornes réelles de la série (4776 registres, 33 lieux, voir
        // scrape_successions_calvados.py) - nouveau département pour ce projet, portail au logiciel
        // non identifié ailleurs (ni Ligeo, ni Anaphore, ni Nuxeo, ni Archinoë) mais mécanisme de
        // recherche classique "search/results?q=...&facet_titleProper=..." - trouvé via recherche
        // web. La plage couvre aussi la série antérieure "contrôle des actes" (avant 1791, mêlée à
        // la même facette "Enregistrement : tables de successions et absences...").
        minYear: 1752,
        maxYear: 2005,
        registersUrl: './assets/data/successions_14.json',
        catalogUrl: 'https://archives.calvados.fr/search/results?q=tables+successions+et+absences&scope=all&mode=table',
    },
    '53': {
        label: 'Mayenne',
        kind: 'facet',
        // Bornes réelles de la série (416 registres, 27 lieux — tous les bureaux, voir
        // scrape_successions_mayenne.py) - nouveau département pour ce projet, portail Pleade
        // (visionneuse EAD, logiciel non identifié ailleurs dans ce projet) entièrement scopé à
        // cette seule série ("Fonds de l'Enregistrement - Tables des successions et absences",
        // FRAD053_2NUM099_RM) - pas de sous-séries voisines à filtrer, contrairement à la plupart
        // des autres départements. Aucun lien direct vers l'image par registre, mais le fonds
        // "2NUM" (numérisation) est numérisé dans son ensemble.
        minYear: 1790,
        maxYear: 1968,
        registersUrl: './assets/data/successions_53.json',
        catalogUrl: 'https://archives.lamayenne.fr/pleade/ead.html?id=FRAD053_2NUM099_RM&c=FRAD053_2NUM099_RM_e0000018',
    },
    '38': {
        label: 'Isère',
        kind: 'facet',
        // Bornes réelles de la série (493 registres, 39 lieux sur 41 bureaux, voir
        // scrape_successions_isere.py) - nouveau département pour ce projet, même famille que la
        // Moselle (un PDF officiel par bureau, pas de tableau HTML par registre). Les PDF les plus
        // anciens ont un filigrane diagonal dont les caractères sont entrelacés avec le texte réel,
        // mais dans une police radicalement plus grande (36-61pt contre 8.8-14pt) - filtré avant
        // extraction (voir le filtre sur "size" dans extract_records) plutôt que de perdre ces
        // bureaux. 2 bureaux non couverts pour de vraies raisons de fond (vérifié individuellement,
        // pas un bug) : L'Isle-d'Abeau n'a fonctionné que de 1992 à 2004, sans table 3Q classique ;
        // Monestier-de-Clermont, supprimé en 1924, n'a qu'un reliquat d'une seule cote "successions
        // payées" (1812-1824) — sa vraie table doit être classée sous Vif ou Clelles, les bureaux
        // qui lui ont succédé.
        minYear: 1791,
        maxYear: 1968,
        registersUrl: './assets/data/successions_38.json',
        catalogUrl: 'https://archives.isere.fr/archive/instruments-de-recherche-63',
    },
    '29': {
        label: 'Finistère',
        kind: 'facet',
        // Bornes réelles de la série (784 registres, 31 lieux — tous les bureaux, voir
        // scripts_py/scrape_finistere.py) - portail Ligeo Archives derrière Anubis, même
        // autorisation explicite que la série de Haute-Garonne, obtenue lors d'une exploration
        // antérieure (voir la liste "départements vérifiés" de recherche.html). Arborescence
        // plus profonde que la Haute-Garonne (un seul fonds "3 Q" commun à tous les bureaux au lieu
        // d'un fonds séparé par bureau), débloquée via la page "Détail du fonds" (arbre EAD
        // classique "tv:/view:") plutôt que l'arbre JS du moteur de recherche du site (qui renvoie
        // des noeuds vides pour ce fonds, raison non éclaircie).
        minYear: 1750,
        maxYear: 1945,
        registersUrl: './assets/data/successions_29.json',
        bureauxUrl: './assets/data/successions_29_bureaux.json',
        catalogUrl: 'https://recherche.archives.finistere.fr/archive/fonds/FRAD029_Enregistrement/n:142',
    },
    '50': {
        label: 'Manche',
        kind: 'facet',
        // Bornes réelles de la série (616 registres, 42 lieux, voir
        // scripts_py/scrape_successions_manche.py) - portail Arkothèque (comme Paris/Allier), mais
        // dépouillé via l'API JSON interne de l'arbre de classement plutôt que le tableau de
        // résultats plat habituel (celui-ci mélange sans distinction fiable les vrais registres et
        // les lignes de résumé par bureau/fonds). Pas de "contrats de mariage" dans ce fonds
        // (vérifié : un seul noeud de premier niveau existe sous "Enregistrement", "Tables de
        // successions" — aucune trace de mariage nulle part sur ce portail).
        minYear: 1718,
        maxYear: 1969,
        registersUrl: './assets/data/successions_50.json',
        bureauxUrl: './assets/data/successions_50_bureaux.json',
        catalogUrl: 'https://www.archives-manche.fr/rechercher-1/repertoires-de-lenregistrement',
    },
    '28': {
        label: 'Eure-et-Loir',
        kind: 'facet',
        // Bornes réelles de la série (386 registres, 23 lieux, voir scrape_successions_arkotheque.py,
        // DEPARTMENTS['28']) - portail Arkothèque. Marqué "champs de données vides" lors d'une
        // première tentative (voir recherche.html) ; retesté en 2026, rendu normal - page déjà
        // scopée à la seule série voulue, le champ "commune" donne directement le bureau.
        minYear: 1760,
        maxYear: 1969,
        registersUrl: './assets/data/successions_28.json',
        bureauxUrl: './assets/data/successions_28_bureaux.json',
        catalogUrl: 'https://archives28.fr/archives-et-inventaires-en-ligne/histoire-des-individus-des-populations-et-genealogie/les-tables-des-successions-et-absences',
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
            r.letterFilter = letterFilterFromCote(r.cote);
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
// imprécises, calendrier républicain converti approximativement). yearGap (0 quand l'année est
// bien couverte) accompagne ce repli pour que l'appelant puisse distinguer un vrai match d'une
// approximation potentiellement lointaine (voir YEAR_GAP_WARNING_THRESHOLD côté affichage).
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

// Candidates à essayer pour une correspondance de commune, du lieu le plus précis (tel qu'acté,
// ex. un lieu-dit/hameau) jusqu'au lieu parent le plus général connu (la commune elle-même, juste
// avant le département) — voir geo.cityChain dans gedcom.js. Un lieu-dit n'a normalement pas son
// propre registre ni son propre bureau : mieux vaut retenter avec son lieu parent que de conclure
// trop vite à "aucune piste".
function cityCandidates(geo) {
    return (geo.cityChain && geo.cityChain.length) ? geo.cityChain : [geo.city];
}
function parentContextLabel(geo, matched) {
    return matched !== geo.city ? `"${geo.city}" non reconnu — résolu via le lieu parent "${matched}"` : null;
}
// Filtre par tranche de patronyme (voir letterFilterFromCote) avant de sélectionner par année :
// un registre sans lettre associée (letterFilter null, l'immense majorité) passe toujours (comme
// matchesLetterFilter) ; si le patronyme ne matche aucune tranche connue (repli), on montre quand
// même tout plutôt que rien - même philosophie que le reste du module (mieux vaut une piste en trop
// qu'une vraie correspondance masquée à tort).
function filterByLetter(records, surname) {
    const bySurname = records.filter(r => matchesLetterFilter(r.letterFilter, surname));
    return bySurname.length ? bySurname : records;
}
// Lyon (Rhône, dept 69) : contrairement aux autres villes 'facet' à bureaux multiples (ex. Lille),
// dont les entrées partagent une commune-siège commune regroupée par bureauNamesFromPlace ("LILLE
// (1er bureau)" -> "LILLE"), les bureaux lyonnais scrapés (voir LYON_BUREAU_RE dans
// scrape_successions_multi.py) portent chacun un nom distinct sans préfixe commun exploitable tel
// quel ("Lyon 1er bureau des actes civils", "Lyon Successions 1"...) - aucun n'est littéralement
// nommé "Lyon". Une recherche sur "Lyon" seul ou "Lyon 5e arrondissement" ne matche donc aucune clé
// exacte de registerIndex et retombait sur successions_69_bureaux.json, un repli géographique conçu
// pour les communes SANS bureau propre - qui pour "Lyon" pointe vers la commune géocodée la plus
// proche (L'Arbresle, Villeurbanne...), sans rapport avec les bureaux de Lyon eux-mêmes. On
// regroupe donc ici tous les registres dont la clé commence par "lyon" et on les propose ensemble,
// comme pour Lille - impossible de deviner depuis le seul GEDCOM lequel des bureaux lyonnais a
// enregistré l'acte.
const LYON_CITY_RE = /^lyon\b/;
function lyonWideRegisters(idx) {
    const all = [];
    idx.registerIndex.forEach((records, key) => {
        if (LYON_CITY_RE.test(key)) all.push(...records);
    });
    return all;
}
function resolveFacet(idx, geo, year, person) {
    const candidates = cityCandidates(geo);
    for (const candidate of candidates) {
        const exact = idx.registerIndex.get(normalizePlace(candidate));
        if (exact && exact.length) {
            const picked = pickRegisters(filterByLetter(exact, person.surname), year);
            return { matchType: 'exact', registers: picked.registers, yearGap: picked.yearGap, bureauInfo: null, contextLabel: parentContextLabel(geo, candidate) };
        }
    }
    for (const candidate of candidates) {
        if (LYON_CITY_RE.test(normalizePlace(candidate))) {
            const lyonAll = lyonWideRegisters(idx);
            if (lyonAll.length) {
                const picked = pickRegisters(filterByLetter(lyonAll, person.surname), year);
                const parentNote = parentContextLabel(geo, candidate);
                return {
                    matchType: 'bureau', registers: picked.registers, yearGap: picked.yearGap, bureauInfo: null,
                    contextLabel: `Lyon avait plusieurs bureaux d'enregistrement distincts — toutes les pistes connues sont listées, à vérifier selon l'arrondissement du décès.${parentNote ? ' ' + parentNote : ''}`,
                };
            }
        }
    }
    for (const candidate of candidates) {
        const bureauInfo = idx.bureauIndex.get(normalizePlace(candidate)) || null;
        const viaBureau = bureauInfo ? idx.registerIndex.get(normalizePlace(bureauInfo.bureau)) : null;
        if (viaBureau && viaBureau.length) {
            const picked = pickRegisters(filterByLetter(viaBureau, person.surname), year);
            return { matchType: 'bureau', registers: picked.registers, yearGap: picked.yearGap, bureauInfo, contextLabel: parentContextLabel(geo, candidate) };
        }
    }
    return { matchType: 'none', registers: [], yearGap: 0, bureauInfo: null, contextLabel: null };
}

function resolveBureauLetter(idx, geo, year, person) {
    let bureau = null, matchedCity = null;
    for (const candidate of cityCandidates(geo)) {
        const history = idx.communeHistory.get(normalizePlace(candidate));
        const found = history ? (history.find(h => year >= h.yearStart && year <= h.yearEnd) || {}).bureau : null;
        if (found) { bureau = found; matchedCity = candidate; break; }
    }
    if (!bureau) {
        return { matchType: 'none', registers: [], yearGap: 0, bureauInfo: null, contextLabel: null };
    }
    const letter = firstSurnameLetter(person.surname);
    const byLetter = idx.registerIndex.get(normalizePlace(bureau));
    const candidates = letter && byLetter ? byLetter.get(letter) : null;
    const parentNote = matchedCity !== geo.city ? ` (via le lieu parent "${matchedCity}")` : '';
    if (candidates && candidates.length) {
        const picked = pickRegisters(candidates, year);
        return {
            matchType: 'exact', registers: picked.registers, yearGap: picked.yearGap, bureauInfo: null,
            contextLabel: `Bureau de ${bureau} — noms commençant par ${letter}${parentNote}`,
        };
    }
    return {
        matchType: 'none', registers: [], yearGap: 0, bureauInfo: null,
        contextLabel: (letter ? `Bureau de ${bureau} (aucun registre pour "${letter}")` : `Bureau de ${bureau} (patronyme inconnu)`) + parentNote,
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

// Certains départements 'facet' subdivisent eux aussi leurs registres par tranche de patronyme au
// sein d'une même ville/année (repéré à Toulouse/Haute-Garonne, ex. cote "F-O (n°2)"), sans que le
// scraper concerné n'expose de champ dédié comme letterFilter à Paris : on le déduit ici du texte
// de la cote plutôt que de retoucher chaque scraper. Motif volontairement strict (toute la cote,
// juste "X-Y" ou "X-Y (n°N)") pour ne matcher que ce cas précis et ne rien casser ailleurs — vérifié
// sur l'ensemble des départements 'facet' au moment d'écrire ceci : seul ce département en produit.
const COTE_LETTER_RANGE_RE = /^([A-Za-zÀ-ÿ])\s*-\s*([A-Za-zÀ-ÿ])\s*(?:\(n°?\s*\d+\))?$/;
function letterFilterFromCote(cote) {
    if (!cote) return null;
    const m = cote.trim().match(COTE_LETTER_RANGE_RE);
    return m ? { mode: 'range', from: m[1].toUpperCase(), to: m[2].toUpperCase() } : null;
}

// Numéro d'arrondissement parisien mentionné dans le texte du lieu de décès du GEDCOM, s'il y en a
// un : ni le format GEDCOM standard ni analyzePlace (gedcom.js) ne distinguent l'arrondissement de
// la commune, donc rien de plus fiable qu'une lecture du texte brut ("Paris 16", "Paris 16e",
// "Paris (16e arrondissement)"...) n'est disponible ici. Un code postal parisien explicite (75016)
// est aussi reconnu, ses deux derniers chiffres encodant l'arrondissement. Hors plage 1-20 (ex. un
// "75" de code département resté collé à "Paris" faute de virgule dans le fichier source) : ignoré,
// ce n'est pas un arrondissement valide.
function extractParisArrondissement(cityStr) {
    if (!cityStr || !/paris/i.test(cityStr)) return null;
    const postal = cityStr.match(/\b750(\d{2})\b/);
    if (postal) { const n = parseInt(postal[1], 10); if (n >= 1 && n <= 20) return n; }
    const m = cityStr.match(/(\d{1,2})\s*(?:e|er|ème|eme)?\b/i);
    if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 20) return n; }
    return null;
}
// Tous les numéros d'arrondissement couverts par un registre (voir r.place, ex. "10e, 16e et 19e
// arrondissements", "11e et 12e arrondissements anciens puis 6e et 13e arrondissements" pour un
// registre ayant changé de ressort en cours de série) : une simple extraction de tous les nombres
// suffit, "ancien(s)"/"et"/"puis" ne sont que des connecteurs. Pas d'ambigüité avec les
// arrondissements "anciens" (numérotation 1795-1860, différente de l'actuelle) : le filtrage par
// année (pickRegisters) a déjà écarté ces registres pour un décès plus tardif avant qu'on y arrive.
function parisPlaceArrondissements(place) {
    return new Set((place.match(/\d+/g) || []).map(n => parseInt(n, 10)));
}

// kind 'citywide' (Paris) : aucune correspondance de lieu à faire (une seule commune dans tout le
// département), mais chaque registre couvre une tranche de patronymes (comme au Tarn, voir kind
// 'bureau-letter') ET un arrondissement/bureau particulier - sans le filtre par patronyme, une
// recherche par année seule renvoie des dizaines de registres (tous les bureaux ET toutes les
// tranches de lettres actifs cette année-là). Quand le lieu de décès du GEDCOM précise lui-même
// l'arrondissement (voir extractParisArrondissement), on filtre aussi dessus ; sinon (cas le plus
// courant, juste "Paris") le contextLabel prévient qu'il reste plusieurs candidats à départager
// soi-même selon l'arrondissement du décès.
function resolveCitywide(idx, geo, year, person) {
    const bySurname = idx.records.filter(r => matchesLetterFilter(r.letterFilter, person.surname));
    const arr = extractParisArrondissement(geo.city);
    const byArr = arr != null ? bySurname.filter(r => parisPlaceArrondissements(r.place).has(arr)) : bySurname;
    const pool = byArr.length ? byArr : bySurname;
    const picked = pickRegisters(pool, year);
    const registers = picked.registers;
    if (!registers.length) {
        return { matchType: 'none', registers: [], yearGap: 0, bureauInfo: null, contextLabel: null };
    }
    const places = new Set(registers.map(r => r.place));
    return {
        matchType: 'exact', registers, yearGap: picked.yearGap, bureauInfo: null,
        contextLabel: places.size > 1
            ? `Paris est organisé par arrondissement : ${registers.length} registre(s) correspondent à cette année, à vérifier selon l'arrondissement du décès.`
            : (arr != null ? `Filtré sur le ${arr}${arr === 1 ? 'er' : 'e'} arrondissement (déduit du lieu de décès).` : null),
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
            : config.kind === 'citywide' ? resolveCitywide(idx, geo, year, p)
            : resolveFacet(idx, geo, year, p);

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
