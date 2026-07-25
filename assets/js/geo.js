// --- GEO DATA ---
export const GEO = {
    deptNames: {"ain":"01","aisne":"02","allier":"03","alpes-de-haute-provence":"04","hautes-alpes":"05","alpes-maritimes":"06","ardèche":"07","ardennes":"08","ariège":"09","aube":"10","aude":"11","aveyron":"12","bouches-du-rhône":"13","calvados":"14","cantal":"15","charente":"16","charente-maritime":"17","cher":"18","corrèze":"19","corse-du-sud":"2A","haute-corse":"2B","côte-d'or":"21","côtes-d'armor":"22","creuse":"23","dordogne":"24","doubs":"25","drôme":"26","eure":"27","eure-et-loir":"28","finistère":"29","gard":"30","haute-garonne":"31","gers":"32","gironde":"33","hérault":"34","ille-et-vilaine":"35","indre":"36","indre-et-loire":"37","isère":"38","jura":"39","landes":"40","loir-et-cher":"41","loire":"42","haute-loire":"43","loire-atlantique":"44","loiret":"45","lot":"46","lot-et-garonne":"47","lozère":"48","maine-et-loire":"49","manche":"50","marne":"51","haute-marne":"52","mayenne":"53","meurthe-et-moselle":"54","meuse":"55","morbihan":"56","moselle":"57","nièvre":"58","nord":"59","oise":"60","orne":"61","pas-de-calais":"62","puy-de-dôme":"63","pyrénées-atlantiques":"64","hautes-pyrénées":"65","pyrénées-orientales":"66","bas-rhin":"67","haut-rhin":"68","rhône":"69","haute-saône":"70","saône-et-loire":"71","sarthe":"72","savoie":"73","haute-savoie":"74","paris":"75","seine-maritime":"76","seine-et-marne":"77","yvelines":"78","deux-sèvres":"79","somme":"80","tarn":"81","tarn-et-garonne":"82","var":"83","vaucluse":"84","vendée":"85","vienne":"86","haute-vienne":"87","vosges":"88","yonne":"89","territoire de belfort":"90","essonne":"91","hauts-de-seine":"92","seine-saint-denis":"93","val-de-marne":"94","val-d'oise":"95","guadeloupe":"971","martinique":"972","guyane":"973","la réunion":"974","mayotte":"976"},
    deptLabels: {},
    regions: ["Hauts-de-France","Auvergne-Rhône-Alpes","Bourgogne-Franche-Comté","Bretagne","Centre-Val de Loire","Corse","Grand Est","Île-de-France","Normandie","Nouvelle-Aquitaine","Occitanie","Pays de la Loire","Provence-Alpes-Côte d'Azur","Alsace","Aquitaine","Auvergne","Basse-Normandie","Bourgogne","Centre","Champagne-Ardenne","Franche-Comté","Haute-Normandie","Languedoc-Roussillon","Limousin","Lorraine","Midi-Pyrénées","Nord-Pas-de-Calais","Picardie","Poitou-Charentes","Rhône-Alpes","Wallonie","Walloon","Flandre","Flanders","Vlaanderen","Bruxelles","Brussels"],
    countryMap: {"france":"France","belgique":"Belgique","belgium":"Belgique","belgië":"Belgique","suisse":"Suisse","switzerland":"Suisse","allemagne":"Allemagne","germany":"Allemagne","deutschland":"Allemagne","italie":"Italie","italy":"Italie","italia":"Italie","espagne":"Espagne","spain":"Espagne","espana":"Espagne","usa":"USA","états-unis":"USA","united states":"USA","uk":"Royaume-Uni","united kingdom":"Royaume-Uni","angleterre":"Royaume-Uni","england":"Royaume-Uni","canada":"Canada","québec":"Canada","algérie":"Algérie","maroc":"Maroc","tunisie":"Tunisie","andorre":"Andorre","andorra":"Andorre","luxembourg":"Luxembourg","pays-bas":"Pays-Bas","netherlands":"Pays-Bas","hollande":"Pays-Bas","holland":"Pays-Bas","autriche":"Autriche","austria":"Autriche","portugal":"Portugal","monaco":"Monaco"}
};
for(let [k,v] of Object.entries(GEO.deptNames)) GEO.deptLabels[v] = k.charAt(0).toUpperCase() + k.slice(1);

// Correspondance libellé pays (tel que produit par GEO.countryMap) -> centroïde approximatif [lng, lat],
// utilisé pour positionner les points de la heatmap MapLibre de la carte du monde.
GEO.countryCentroids = {
    "France": [2.5, 46.6], "Belgique": [4.5, 50.6], "Suisse": [8.2, 46.8], "Allemagne": [10.4, 51.2],
    "Italie": [12.6, 41.9], "Espagne": [-3.7, 40.3], "USA": [-98.6, 39.8], "Royaume-Uni": [-1.5, 52.9],
    "Canada": [-106.3, 56.1], "Algérie": [2.6, 28.2], "Maroc": [-7.1, 31.8], "Tunisie": [9.5, 33.9],
    "Andorre": [1.6, 42.5], "Luxembourg": [6.1, 49.6],
    "Pays-Bas": [5.3, 52.1], "Autriche": [14.6, 47.6], "Portugal": [-8.2, 39.6], "Monaco": [7.4, 43.7]
};

// Coordonnées [lng, lat] de la préfecture de chaque département français, utilisées pour positionner
// les points de la heatmap du monde avec une résolution plus fine que le simple centroïde du pays.
GEO.deptCentroids = {
    "01":[5.2265,46.2058], "02":[3.6229,49.5642], "03":[3.3327,46.5606], "04":[6.2356,44.0919],
    "05":[6.0679,44.5594], "06":[7.2620,43.7102], "07":[4.5975,44.7355], "08":[4.7167,49.7739],
    "09":[1.6052,42.9647], "10":[4.0744,48.2973], "11":[2.3499,43.2130], "12":[2.5744,44.3506],
    "13":[5.3698,43.2965], "14":[-0.3707,49.1829], "15":[2.4453,44.9282], "16":[0.1558,45.6486],
    "17":[-1.1511,46.1603], "18":[2.3966,47.0810], "19":[1.7716,45.2652], "2A":[8.7369,41.9192],
    "2B":[9.4500,42.6976], "21":[5.0415,47.3220], "22":[-2.7639,48.5142], "23":[1.8686,46.1667],
    "24":[0.7211,45.1848], "25":[6.0241,47.2378], "26":[4.8912,44.9334], "27":[1.1510,49.0245],
    "28":[1.4900,48.4469], "29":[-4.0972,47.9960], "30":[4.3600,43.8367], "31":[1.4442,43.6047],
    "32":[0.5847,43.6455], "33":[-0.5792,44.8378], "34":[3.8767,43.6108], "35":[-1.6778,48.1173],
    "36":[1.6961,46.8106], "37":[0.6848,47.3941], "38":[5.7245,45.1885], "39":[5.5510,46.6739],
    "40":[-0.4986,43.8905], "41":[1.3359,47.5861], "42":[4.3872,45.4397], "43":[3.8850,45.0430],
    "44":[-1.5534,47.2184], "45":[1.9039,47.9029], "46":[1.4442,44.4479], "47":[0.6218,44.2019],
    "48":[3.5000,44.5183], "49":[-0.5632,47.4784], "50":[-1.0899,49.1146], "51":[4.3656,48.9558],
    "52":[5.1391,48.1113], "53":[-0.7708,48.0698], "54":[6.1844,48.6921], "55":[5.1608,48.7706],
    "56":[-2.7600,47.6582], "57":[6.1757,49.1193], "58":[3.1573,46.9896], "59":[3.0573,50.6292],
    "60":[2.0844,49.4295], "61":[0.0916,48.4304], "62":[2.7772,50.2910], "63":[3.0870,45.7772],
    "64":[-0.3697,43.2951], "65":[0.0781,43.2327], "66":[2.8954,42.6886], "67":[7.7521,48.5734],
    "68":[7.3581,48.0794], "69":[4.8357,45.7640], "70":[6.1541,47.6236], "71":[4.8300,46.3069],
    "72":[0.1996,48.0061], "73":[5.9178,45.5646], "74":[6.1294,45.8992], "75":[2.3522,48.8566],
    "76":[1.0993,49.4431], "77":[2.6597,48.5388], "78":[2.1301,48.8014], "79":[-0.4634,46.3231],
    "80":[2.2957,49.8942], "81":[2.1480,43.9298], "82":[1.3510,44.0181], "83":[5.9280,43.1242],
    "84":[4.8059,43.9493], "85":[-1.4267,46.6705], "86":[0.3404,46.5802], "87":[1.2611,45.8336],
    "88":[6.4483,48.1735], "89":[3.5730,47.7982], "90":[6.8637,47.6389], "91":[2.4297,48.6280],
    "92":[2.2069,48.8924], "93":[2.4392,48.9083], "94":[2.4614,48.7904], "95":[2.0761,49.0362],
    "971":[-61.7333,16.0000], "972":[-61.0667,14.6000], "973":[-52.3333,4.9333],
    "974":[55.4500,-20.8789], "976":[45.1662,-12.7806]
};

// Alias de noms de départements historiques (avant les renommages du XXe siècle), encore
// courants dans les actes anciens : ex. "Côtes-du-Nord" (Côtes-d'Armor depuis 1990),
// "Loire-Inférieure" (Loire-Atlantique depuis 1957), "Seine-Inférieure" (Seine-Maritime, 1955).
GEO.deptHistoricalAliases = {
    "côtes-du-nord": "22", "loire-inférieure": "44", "seine-inférieure": "76",
    "charente-inférieure": "17", "basses-alpes": "04", "basses-pyrénées": "64"
};

// Traductions anglaises ponctuelles de noms de départements, rencontrées dans des GEDCOM
// renseignés en anglais (ex. "North" pour "Nord"). Volontairement PAS fusionnées dans la table
// de recherche floue globale (GEO.deptEntriesNorm) : un mot aussi générique que "north"
// apparaîtrait dans une multitude de lieux hors de France (North Yorkshire, North Carolina…) et
// produirait de faux positifs. Elle n'est donc utilisée que là où un "PLAC.FORM" nous dit déjà
// avec certitude qu'un segment donné EST le champ Département (voir analyzePlace ci-dessous).
GEO.deptEnglishAliases = { "north": "59" };

// Normalisation de lieu partagée (minuscules, sans accents/tirets/ponctuation) et tables de
// recherche précalculées une seule fois au chargement, plutôt que reconstruites à chaque appel
// à analyzePlace : avec des GEDCOM de plusieurs milliers d'événements, refaire ~150 normalisations
// (une par pays/région/département candidat, chacune recréant son propre regex diacritique) pour
// CHAQUE lieu rendait le parsing nettement plus lent que nécessaire.
const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
export function normalizePlace(s) {
    return s.toLowerCase().normalize('NFD').replace(DIACRITICS_RE, '')
        .replace(/[-''`]/g, ' ').replace(/[.,;:]/g, ' ');
}
export const BELGIAN_REGIONS = new Set(["Wallonie","Flandre","Bruxelles","Brussels","Walloon","Flanders","Vlaanderen"]);
GEO.countryEntriesNorm = Object.entries(GEO.countryMap).map(([k, v]) => [normalizePlace(k), v]);
GEO.regionEntriesNorm = GEO.regions.map(r => [normalizePlace(r), r]);
// Trié du nom le plus long au plus court : évite qu'un département dont le nom est un sous-mot
// d'un autre (ex. "Loire" dans "Loire-Atlantique", "Cher" dans "Loir-et-Cher", "Nord" dans
// l'ancien nom "Côtes-du-Nord") ne soit détecté à la place du bon département.
GEO.deptEntriesNorm = Object.entries({ ...GEO.deptNames, ...GEO.deptHistoricalAliases })
    .map(([name, code]) => {
        const n = normalizePlace(name);
        return { code, len: n.length, regex: new RegExp(`(^|\\s|,)${n.replace(/\s+/g, '\\s*')}(\\s|,|$)`) };
    })
    .sort((a, b) => b.len - a.len);
export function findDept(normText) {
    for(const e of GEO.deptEntriesNorm) if(e.regex.test(normText)) return e.code;
    return null;
}

// Extrait le code INSEE ("33") d'un libellé de département tel que stocké par analyzePlace
// ("33 - Gironde"), utilisé par les outils qui filtrent sur une liste de départements précise.
export function deptCode(deptDisplay) {
    if(!deptDisplay) return null;
    return deptDisplay.split(' - ')[0];
}
