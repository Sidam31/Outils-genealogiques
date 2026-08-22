import { GEO, normalizePlace, deptCode } from './geo.js';
import { escapeHtml, computeStats, decadeOf, centuryOf, periodOf, WEEKDAY_LABELS } from './utils.js';
import { labelForOther } from './timeline.js';

export function showMapMessage(containerId, text, isError) {
    d3.select(`#${containerId}`).html(`<div class="map-placeholder"${isError ? ' style="color:#c0392b"' : ''}>${text}</div>`);
}

// --- CARTES ---
let franceGeoCache = null;
export async function ensureFranceGeo() {
    if(!franceGeoCache) {
        const res = await fetch('https://raw.githubusercontent.com/Sidam31/ICA-APHP/refs/heads/main/Data/data_carte.geojson');
        franceGeoCache = await res.json();
    }
    return franceGeoCache;
}

// Inverse l'ordre des points de chaque anneau (Polygon/MultiPolygon) : la source "Belgium-Geographic-
// Data" (convertie depuis un shapefile Esri, à en juger par ses propriétés "RecId"/"Shape_Leng"/
// "Shape_Area") encode SES anneaux dans le sens Esri (extérieur horaire), l'inverse de la convention
// GeoJSON RFC 7946/d3-geo (extérieur antihoraire). Sans ce correctif, d3.geoBounds/d3.geoPath
// interprètent chaque province comme couvrant la quasi-totalité du globe (un seul point de la sphère
// exclu), ce qui casse à la fois fitExtent (échelle ~100 au lieu de plusieurs milliers) et le rendu
// (chaque province se dessine comme un rectangle couvrant tout le cadre). Vérifié empiriquement :
// inverser tous les anneaux (extérieurs ET trous, peu importe leur sens d'origine) suffit à corriger
// les deux symptômes, la relation d'orientation relative extérieur/trou étant préservée par l'inversion.
function fixEsriRingWinding(geometry) {
    const reverseRings = rings => rings.map(ring => ring.slice().reverse());
    if(geometry.type === 'Polygon') return { ...geometry, coordinates: reverseRings(geometry.coordinates) };
    if(geometry.type === 'MultiPolygon') return { ...geometry, coordinates: geometry.coordinates.map(reverseRings) };
    return geometry;
}

// Contours des provinces belges (+ Région de Bruxelles-Capitale, traitée comme une entrée de plus) :
// même principe que ensureFranceGeo, source distincte car aucune des deux ne couvre l'autre pays.
// Chaque feature porte un "AdPrKey" (propriétés) qui correspond aux codes de GEO.beProvinceLabels.
let belgiumGeoCache = null;
export async function ensureBelgiumGeo() {
    if(!belgiumGeoCache) {
        const res = await fetch('https://raw.githubusercontent.com/mathiasleroy/Belgium-Geographic-Data/master/dist/polygons/geojson/Belgium.provinces.WGS84.geojson');
        const raw = await res.json();
        belgiumGeoCache = { ...raw, features: raw.features.map(f => ({ ...f, geometry: fixEsriRingWinding(f.geometry) })) };
    }
    return belgiumGeoCache;
}

// Pays limitrophes/proches affichés en gris clair autour de la France sur la carte des
// départements, pour donner un contexte géographique (pas de coloration par données).
let europeGeoCache = null;
export async function ensureEuropeGeo() {
    if(!europeGeoCache) {
        // Natural Earth admin-0 (résolution 110m) : fichier léger, suffisant pour de simples
        // contours de pays voisins (on n'a pas besoin du détail utilisé pour les départements).
        const res = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
        const raw = await res.json();
        // La résolution 110m rend très mal les micro-États : l'Andorre y garde une entrée, mais
        // réduite à une poignée de points (constaté : un blob grossier proche d'un demi-disque plutôt
        // que son contour réel), ce qui déforme à la fois le contexte "pays voisins" de la carte de
        // France (NEIGHBOR_COUNTRY_LABELS) et le repli Natural Earth de la vue Europe par pays
        // (drawEuropeMap, pour les années hors couverture CShapes). Remplacée SYSTÉMATIQUEMENT (pas
        // seulement si absente) par un contour dédié bundlé localement (assets/data/andorra.geojson) :
        // à cette résolution, "présente" ne veut pas dire "correcte".
        try {
            const andorraRes = await fetch('./assets/data/andorra.geojson');
            const andorraGeo = await andorraRes.json();
            const andorraFeature = andorraGeo.features[0];
            if(andorraFeature) {
                raw.features = raw.features.filter(f => (f.properties?.ADMIN || f.properties?.NAME) !== 'Andorra');
                raw.features.push({ ...andorraFeature, properties: { ...andorraFeature.properties, ADMIN: 'Andorra', NAME: 'Andorra' } });
            }
        } catch(err) { /* pas de contour Andorre dédié : on garde tel quel celui (dégradé) de Natural Earth */ }
        europeGeoCache = raw;
    }
    return europeGeoCache;
}
// Nom (Natural Earth, en anglais) -> libellé canonique utilisé dans byCountry (valeurs de
// GEO.countryMap), pour pouvoir retrouver le nombre d'occurrences de chaque pays voisin.
const NEIGHBOR_COUNTRY_LABELS = new Map([
    ['Belgium', 'Belgique'], ['Luxembourg', 'Luxembourg'], ['Germany', 'Allemagne'],
    ['Switzerland', 'Suisse'], ['Italy', 'Italie'], ['Spain', 'Espagne'],
    ['Andorra', 'Andorre'], ['Monaco', 'Monaco'], ['United Kingdom', 'Royaume-Uni'],
    ['Netherlands', 'Pays-Bas'], ['Austria', 'Autriche'], ['Portugal', 'Portugal']
]);
export function neighborCountryLabel(f) {
    const name = f.properties?.ADMIN || f.properties?.NAME || f.properties?.name || f.properties?.NAME_EN || '';
    return NEIGHBOR_COUNTRY_LABELS.get(name) || null;
}

// --- Coordonnées GPS déduites par commune, en secours quand le GEDCOM n'a pas de LATI/LONG ---
// Un fichier compact par département français (assets/data/communes_geo/{dept}.json, construit par
// scripts_py/build_communes_geo.py à partir de la base "communes_evolution") : chaque entrée liste,
// pour une commune, son nom actuel et ses noms historiques (fusions/renommages), avec ses
// coordonnées — ce qui permet de retrouver un lieu cité sous un ancien nom dans un acte ancien. Un
// fichier par département (~5-30 Ko chacun) plutôt qu'un seul fichier national (~1,3 Mo) : seuls les
// départements réellement présents dans le GEDCOM chargé sont téléchargés.
const communeGeoCache = new Map(); // code département -> Promise<Map<nom normalisé, [lat, lon]>>
function ensureCommuneGeo(dept) {
    if(!communeGeoCache.has(dept)) {
        communeGeoCache.set(dept, fetch(`./assets/data/communes_geo/${dept}.json`)
            .then(res => { if(!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(entries => new Map(entries.flatMap(([names, lat, lon]) => names.map(n => [normalizePlace(n), [lat, lon]]))))
            .catch(() => new Map()));
    }
    return communeGeoCache.get(dept);
}

// Complète en place, pour chaque individu, les coordonnées GPS manquantes (naissance/décès/mariage/
// résidences) à partir du nom de commune déjà extrait par analyzePlace (geo.city/geo.dept), quand la
// commune est reconnue dans la base ci-dessus. N'écrase jamais des coordonnées déjà connues (LATI/LONG
// du GEDCOM), qui restent prioritaires. À appeler une fois après le chargement d'un GEDCOM : les objets
// geo sont mutés une seule fois puis réutilisés par tous les rendus (filtres, curseur temporel, carte
// par département...).
export async function enrichMissingCoords(list) {
    const seen = new Set(), pending = [];
    const collect = geo => {
        if(!geo || geo.lat != null || !geo.city || (!geo.dept && !geo.beProvince) || seen.has(geo)) return;
        seen.add(geo);
        pending.push(geo);
    };
    list.forEach(i => {
        collect(i.birth?.geo); collect(i.death?.geo); collect(i.marrGeo);
        (i.resiEvents || []).forEach(r => collect(r.geo));
    });
    if(!pending.length) return;

    // Clé de fichier commune à ensureCommuneGeo : "01" pour un département français, "BE-60000"
    // pour une province belge (cf. build_communes_geo_be.py) — le dossier communes_geo/ est
    // partagé entre les deux jeux de données, seul le préfixe "BE-" les distingue.
    const keyOf = geo => geo.dept ? deptCode(geo.dept) : `BE-${deptCode(geo.beProvince)}`;
    const keys = Array.from(new Set(pending.map(keyOf)));
    const nameMapsByKey = new Map(await Promise.all(keys.map(async k => [k, await ensureCommuneGeo(k)])));
    pending.forEach(geo => {
        const nameMap = nameMapsByKey.get(keyOf(geo));
        const hit = nameMap && nameMap.get(normalizePlace(geo.city));
        if(hit) { geo.lat = hit[0]; geo.lon = hit[1]; }
    });
}

const GEO_EVENT_LABELS = { BIRT: 'Naissance', DEAT: 'Décès', MARR: 'Mariage' };

// Compte les lieux (pays / département) par type d'événement activé, pour un ensemble d'individus
// donné. opts.yearMin/opts.yearMax, si fournis, restreignent aux événements datés et survenus dans
// cet intervalle (bornes incluses ; permet de rejouer l'évolution des lieux au fil du temps) ; sans
// bornes, les événements sans date connue restent inclus comme avant.
export function computeGeoCounts(scopeIds, individuals, eventFlags, opts) {
    const yearMin = opts && opts.yearMin != null ? opts.yearMin : null;
    const yearMax = opts && opts.yearMax != null ? opts.yearMax : null;
    const byCountry = {}, byDept = {}, byBeProvince = {};
    // Points pour la heatmap du monde : résolution département (préfecture) pour la France
    // quand on la connaît, sinon centroïde du pays. Clé -> { label, coords, count, items }.
    // items liste, pour l'infobulle, chaque événement/personne ayant contribué à ce point.
    const byWorldPoint = {};
    const addPoint = (key, label, coords, item) => {
        if(!coords) return;
        if(!byWorldPoint[key]) byWorldPoint[key] = { label, coords, count: 0, items: [] };
        byWorldPoint[key].count++;
        if(item) byWorldPoint[key].items.push(item);
    };
    const add = (geo, item) => {
        if(!geo) return;
        if(geo.country && geo.country !== 'Inconnu') byCountry[geo.country] = (byCountry[geo.country] || 0) + 1;
        if(geo.dept) byDept[geo.dept.split(' - ')[0]] = (byDept[geo.dept.split(' - ')[0]] || 0) + 1;
        if(geo.beProvince) byBeProvince[geo.beProvince.split(' - ')[0]] = (byBeProvince[geo.beProvince.split(' - ')[0]] || 0) + 1;
        // Priorité aux coordonnées GPS exactes du GEDCOM (LATI/LONG), sinon préfecture du
        // département/province, sinon centroïde du pays.
        if(geo.lat != null && geo.lon != null) {
            addPoint('gps:' + geo.lat.toFixed(3) + ',' + geo.lon.toFixed(3), geo.dept || geo.beProvince || geo.raw || geo.country, [geo.lon, geo.lat], item);
            return;
        }
        if(geo.dept) {
            const code = geo.dept.split(' - ')[0];
            if(GEO.deptCentroids[code]) { addPoint('dept:' + code, geo.dept, GEO.deptCentroids[code], item); return; }
        }
        if(geo.beProvince) {
            const code = geo.beProvince.split(' - ')[0];
            if(GEO.beProvinceCentroids[code]) { addPoint('beprov:' + code, geo.beProvince, GEO.beProvinceCentroids[code], item); return; }
        }
        if(geo.country && geo.country !== 'Inconnu') addPoint('country:' + geo.country, geo.country, GEO.countryCentroids[geo.country], item);
    };
    // Avec un filtre temporel actif, seuls les événements datés (et compris dans l'intervalle)
    // comptent — un événement sans date ne peut pas être situé dans le temps, donc il n'apparaît
    // que lorsque le filtre temporel est désactivé (comportement identique au slider par décennie
    // de la pyramide des âges, cf. drawAgePyramidForSelectedDecade).
    const passesTime = year => {
        if(yearMin == null && yearMax == null) return true;
        if(year == null) return false;
        return (yearMin == null || year >= yearMin) && (yearMax == null || year <= yearMax);
    };
    scopeIds.forEach(id => {
        const i = individuals.get(id);
        if(!i) return;
        if(eventFlags.BIRT && passesTime(i.birth?.year)) add(i.birth?.geo, { name: i.name, type: 'BIRT', typeLabel: GEO_EVENT_LABELS.BIRT, year: i.birth?.year || null });
        if(eventFlags.DEAT && passesTime(i.death?.year)) add(i.death?.geo, { name: i.name, type: 'DEAT', typeLabel: GEO_EVENT_LABELS.DEAT, year: i.death?.year || null });
        if(eventFlags.MARR && passesTime(i.marrYear)) add(i.marrGeo, { name: i.name, type: 'MARR', typeLabel: GEO_EVENT_LABELS.MARR, year: i.marrYear || null });
    });
    return { byCountry, byDept, byBeProvince, byWorldPoint };
}

// --- Carte du monde : heatmap MapLibre GL (WebGL), cf. exemple officiel MapLibre "heatmap-layer".
// La carte elle-même n'est créée qu'une fois (coûteux : contexte WebGL) ; les appels suivants
// se contentent de mettre à jour la source de données et l'échelle de poids/rayon.
const WORLD_MAP_CENTER = [10, 40], WORLD_MAP_ZOOM = 1.2;
let worldMap = null, worldMapLoadPromise = null, worldMapPopup = null;

export function ensureWorldMap() {
    if(worldMapLoadPromise) return worldMapLoadPromise;
    worldMapLoadPromise = new Promise((resolve, reject) => {
        if(typeof maplibregl === 'undefined') { reject(new Error('maplibre-gl indisponible')); return; }
        document.getElementById('worldMapChart').innerHTML = '';
        try {
            worldMap = new maplibregl.Map({
                container: 'worldMapChart',
                style: 'https://demotiles.maplibre.org/style.json',
                center: WORLD_MAP_CENTER,
                zoom: WORLD_MAP_ZOOM,
                preserveDrawingBuffer: true // requis pour la copie d'image (canvas.toBlob)
            });
        } catch(err) { reject(err); return; }
        worldMap.addControl(new maplibregl.NavigationControl(), 'top-right');
        worldMap.on('load', () => {
            worldMap.addSource('ancestors', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            worldMap.addLayer({
                id: 'ancestors-heat',
                type: 'heatmap',
                source: 'ancestors',
                maxzoom: 9,
                paint: {
                    'heatmap-weight': ['interpolate', ['linear'], ['get', 'count'], 0, 0, 1, 1],
                    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
                    'heatmap-color': [
                        'interpolate', ['linear'], ['heatmap-density'],
                        0, 'rgba(33,102,172,0)', 0.2, 'rgb(103,169,207)', 0.4, 'rgb(209,229,240)',
                        0.6, 'rgb(253,219,199)', 0.8, 'rgb(239,138,98)', 1, 'rgb(178,24,43)'
                    ],
                    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 14, 9, 45],
                    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 1, 9, 0]
                }
            });
            worldMap.addLayer({
                id: 'ancestors-point',
                type: 'circle',
                source: 'ancestors',
                minzoom: 6,
                paint: {
                    'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 5, 50, 30],
                    'circle-color': '#b2182b',
                    'circle-stroke-color': 'white',
                    'circle-stroke-width': 1,
                    'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 7, 0.85]
                }
            });
            worldMap.on('mouseenter', 'ancestors-point', e => {
                worldMap.getCanvas().style.cursor = 'pointer';
                const f = e.features[0];
                worldMapPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px' })
                    .setLngLat(f.geometry.coordinates)
                    .setHTML(worldPointPopupHtml(f.properties))
                    .addTo(worldMap);
            });
            worldMap.on('mouseleave', 'ancestors-point', () => {
                worldMap.getCanvas().style.cursor = '';
                if(worldMapPopup) { worldMapPopup.remove(); worldMapPopup = null; }
            });
            const resetBtn = document.getElementById('worldMapResetBtn');
            if(resetBtn) resetBtn.onclick = () => worldMap.flyTo({ center: WORLD_MAP_CENTER, zoom: WORLD_MAP_ZOOM });
            resolve(worldMap);
        });
        worldMap.on('error', e => console.warn('MapLibre:', e?.error || e));
    });
    return worldMapLoadPromise;
}

const WORLD_POINT_EVENT_ICONS = { BIRT: '👶', DEAT: '⚰️', MARR: '💍' };
const WORLD_POINT_POPUP_MAX_ITEMS = 25;

// Contenu de l'infobulle d'un point de la heatmap monde : liste les événements et les personnes
// à l'origine de ce point (et non plus seulement leur nombre), pour pouvoir identifier qui a
// vécu/est né/mort à cet endroit sans quitter la carte.
function worldPointPopupHtml(properties) {
    let items = [];
    try { items = JSON.parse(properties.items || '[]'); } catch(err) { /* ignore */ }
    const rows = items.slice(0, WORLD_POINT_POPUP_MAX_ITEMS).map(it =>
        `<div class="tt-row"><span>${WORLD_POINT_EVENT_ICONS[it.type] || '•'} ${escapeHtml(it.name || 'Inconnu')}</span><span>${it.year ? escapeHtml(String(it.year)) : ''}</span></div>`
    ).join('');
    const more = items.length > WORLD_POINT_POPUP_MAX_ITEMS
        ? `<div class="tt-row" style="opacity:.7;font-style:italic">…et ${items.length - WORLD_POINT_POPUP_MAX_ITEMS} autre(s)</div>` : '';
    return `<strong>${escapeHtml(properties.label)}</strong><br>Occurrences&nbsp;: ${properties.count}` +
        (items.length ? `<div style="margin-top:6px;max-height:220px;overflow-y:auto">${rows}${more}</div>` : '');
}

export async function drawWorldMap(byWorldPoint) {
    const features = Object.values(byWorldPoint).map(p => ({
        type: 'Feature',
        properties: { label: p.label, count: p.count, items: JSON.stringify(p.items || []) },
        geometry: { type: 'Point', coordinates: p.coords }
    }));
    const maxCount = Math.max(1, ...features.map(f => f.properties.count));

    let m;
    try {
        m = await ensureWorldMap();
    } catch(err) {
        showMapMessage('worldMapChart', 'Impossible de charger la carte du monde (connexion internet requise).', true);
        return;
    }
    m.getSource('ancestors').setData({ type: 'FeatureCollection', features });
    // Bornes en 0 (et non 1) pour garantir des paliers strictement croissants même quand
    // maxCount === 1 (sinon "interpolate" reçoit deux paliers à la même valeur et lève une erreur).
    m.setPaintProperty('ancestors-heat', 'heatmap-weight', ['interpolate', ['linear'], ['get', 'count'], 0, 0, maxCount, 1]);
    m.setPaintProperty('ancestors-point', 'circle-radius', ['interpolate', ['linear'], ['get', 'count'], 0, 5, maxCount, 30]);
}

// Codes de département français valides (issus de GEO.deptNames) : sert à ignorer les entrées
// hors France présentes dans le geojson (ex: départements historiques belges "B01"-"B11").
const FRENCH_DEPT_CODES = new Set(Object.values(GEO.deptNames));

// Ticks entiers, sans doublons, pour les légendes de carte : d3's .ticks(n) génère parfois des
// valeurs décimales qui, une fois arrondies à l'entier pour l'affichage ("0 occurrence" n'a pas de
// sens en 0.3), se répètent (ex. 0, 0, 0, 1, 1, 1 quand le maximum ne vaut que 1). En dessous de
// maxTicks, on affiche directement chaque entier de 0 au maximum plutôt que de laisser d3 deviner.
function niceIntegerTicks(maxVal, maxTicks) {
    maxVal = Math.max(0, Math.round(maxVal));
    if(maxVal <= maxTicks) return Array.from({ length: maxVal + 1 }, (_, i) => i);
    return Array.from(new Set(d3.scaleLinear().domain([0, maxVal]).ticks(maxTicks).map(Math.round)));
}

export async function drawFranceMap(byDept, byCountry) {
    byCountry = byCountry || {};
    const container = d3.select('#franceMapChart');
    showMapMessage('franceMapChart', 'Chargement de la carte de France…');

    let geojsonRaw;
    try {
        geojsonRaw = await ensureFranceGeo();
    } catch(err) {
        showMapMessage('franceMapChart', 'Impossible de charger la carte de France (connexion internet requise).', true);
        return;
    }
    if(!document.getElementById('franceMapChart')) return;
    const features = geojsonRaw.features.filter(f => FRENCH_DEPT_CODES.has(f.properties.code));

    // Contours des pays voisins : gris clair mais avec un compteur d'occurrences au survol (comme
    // les départements), donc on ne bloque pas l'affichage de la France si cette requête échoue.
    let neighborFeatures = [];
    try {
        const europeGeo = await ensureEuropeGeo();
        neighborFeatures = europeGeo.features.filter(f => neighborCountryLabel(f) !== null);
    } catch(err) { /* pas de contours voisins, la carte de France seule reste fonctionnelle */ }
    if(!document.getElementById('franceMapChart')) return;

    container.selectAll('*').remove();
    const width = container.node().clientWidth || 500, height = 420;
    const svg = container.append('svg').attr('width', width).attr('height', height);

    // Zoom légèrement moins serré que pour la France seule, pour laisser de la place aux pays
    // voisins autour (ceux qui débordent du cadre, ex. le nord du Royaume-Uni, sont simplement
    // coupés au bord : la France reste le sujet principal de la carte).
    const projection = d3.geoConicConformal()
        .center([2.454071, 46.279229])
        .scale(height * 3.1)
        .translate([width / 2, height / 2]);
    const path = d3.geoPath().projection(projection);
    const maxCount = d3.max(Object.values(byDept)) || 1;
    // Échelle en racine carrée (et non linéaire) : avec une échelle linéaire, un département à
    // 1000+ occurrences écrase visuellement tous les autres (qui deviennent quasi invisibles,
    // tous très proches de la couleur "0"). La racine carrée donne plus de contraste aux petites
    // valeurs tout en gardant les grandes valeurs distinctes.
    const colorScale = d3.scaleSequentialSqrt(d3.interpolateBlues).domain([0, maxCount]);
    // Échelle séparée pour les pays voisins : leurs comptages (par pays entier) sont d'un ordre de
    // grandeur très différent de ceux des départements français, donc on ne peut pas partager le
    // même domaine [0, maxCount] sans que les voisins n'apparaissent presque tous blancs.
    const neighborCounts = neighborFeatures.map(f => byCountry[neighborCountryLabel(f)] || 0);
    const maxNeighborCount = Math.max(1, ...neighborCounts);
    const neighborColorScale = d3.scaleSequentialSqrt(d3.interpolateOranges).domain([0, maxNeighborCount]);

    const tooltip = document.getElementById('tooltip');

    // Pays voisins en arrière-plan, dessinés avant (donc sous) les départements français, colorés
    // par nombre d'occurrences comme les départements (mais avec leur propre échelle, voir plus haut).
    if(neighborFeatures.length) {
        svg.selectAll('path.neighbor')
            .data(neighborFeatures)
            .join('path')
            .attr('class', 'neighbor')
            .attr('d', path)
            .attr('fill', d => { const c = byCountry[neighborCountryLabel(d)] || 0; return c > 0 ? neighborColorScale(c) : '#f0f0f0'; })
            .attr('stroke', '#888')
            .attr('stroke-width', 0.6)
            .style('cursor', 'default')
            .on('mouseover', function(e, d) {
                const label = neighborCountryLabel(d);
                const count = byCountry[label] || 0;
                d3.select(this).attr('stroke', '#0055A4').attr('stroke-width', 2);
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${label}</strong><div class="tt-row"><span>Occurrences</span><span>${count}</span></div>`;
            })
            .on('mousemove', e => {
                tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
                tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
            })
            .on('mouseout', function() {
                d3.select(this).attr('stroke', '#888').attr('stroke-width', 0.6);
                tooltip.style.opacity = 0;
            });
    }

    svg.selectAll('path.dept')
        .data(features)
        .join('path')
        .attr('class', 'dept')
        .attr('d', path)
        .attr('fill', d => { const c = byDept[d.properties.code] || 0; return c > 0 ? colorScale(c) : '#f0f0f0'; })
        .attr('stroke', '#555')
        .attr('stroke-width', 0.8)
        .style('cursor', 'default')
        .on('mouseover', function(e, d) {
            const count = byDept[d.properties.code] || 0;
            d3.select(this).attr('stroke', '#0055A4').attr('stroke-width', 2);
            tooltip.style.opacity = 1;
            tooltip.innerHTML = `<strong>${d.properties.nom || d.properties.code}</strong><div class="tt-row"><span>Occurrences</span><span>${count}</span></div>`;
        })
        .on('mousemove', e => {
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('stroke', '#555').attr('stroke-width', 0.8);
            tooltip.style.opacity = 0;
        });

    // Légende : dégradé linéaire en valeur (0 -> maxCount), coloré via la même échelle sqrt que la
    // carte, avec un axe pour donner un ordre de grandeur des occurrences.
    const legendWidth = 180, legendHeight = 12;
    const legendX = width - legendWidth - 20, legendY = height - 34;
    const gradientId = 'franceMapGradient';
    const gradient = svg.append('defs').append('linearGradient')
        .attr('id', gradientId).attr('x1', '0%').attr('x2', '100%').attr('y1', '0%').attr('y2', '0%');
    const stopCount = 10;
    for(let i = 0; i <= stopCount; i++) {
        const t = i / stopCount;
        gradient.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorScale(t * maxCount));
    }
    const legend = svg.append('g').attr('transform', `translate(${legendX},${legendY})`);
    legend.append('text').attr('x', 0).attr('y', -6).style('font-size', '10px').style('font-weight', 'bold').style('fill', '#333')
        .text('Occurrences par département');
    legend.append('rect').attr('width', legendWidth).attr('height', legendHeight)
        .style('fill', `url(#${gradientId})`).attr('stroke', '#999').attr('stroke-width', 0.5);
    const legendScale = d3.scaleLinear().domain([0, maxCount]).range([0, legendWidth]);
    legend.append('g').attr('transform', `translate(0,${legendHeight})`)
        .call(d3.axisBottom(legendScale).tickValues(niceIntegerTicks(maxCount, 4)).tickFormat(d3.format('d')))
        .selectAll('text').style('font-size', '9px');

    // Seconde légende, pour l'échelle (distincte) des pays voisins : empilée au même endroit que
    // celle des départements (même coin, même largeur), juste au-dessus.
    if(neighborFeatures.length) {
        const nLegendWidth = legendWidth, nLegendHeight = legendHeight;
        const nLegendX = legendX, nLegendY = legendY - 48;
        const nGradientId = 'franceMapNeighborGradient';
        const nGradient = svg.append('defs').append('linearGradient')
            .attr('id', nGradientId).attr('x1', '0%').attr('x2', '100%').attr('y1', '0%').attr('y2', '0%');
        for(let i = 0; i <= stopCount; i++) {
            const t = i / stopCount;
            nGradient.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', neighborColorScale(t * maxNeighborCount));
        }
        const nLegend = svg.append('g').attr('transform', `translate(${nLegendX},${nLegendY})`);
        nLegend.append('text').attr('x', 0).attr('y', -6).style('font-size', '10px').style('font-weight', 'bold').style('fill', '#333')
            .text('Occurrences par pays voisin');
        nLegend.append('rect').attr('width', nLegendWidth).attr('height', nLegendHeight)
            .style('fill', `url(#${nGradientId})`).attr('stroke', '#999').attr('stroke-width', 0.5);
        const nLegendScale = d3.scaleLinear().domain([0, maxNeighborCount]).range([0, nLegendWidth]);
        nLegend.append('g').attr('transform', `translate(0,${nLegendHeight})`)
            .call(d3.axisBottom(nLegendScale).tickValues(niceIntegerTicks(maxNeighborCount, 4)).tickFormat(d3.format('d')))
            .selectAll('text').style('font-size', '9px');
    }
}

// --- CARTE DE BELGIQUE (choroplèthe par province) ---
// Pendant de drawFranceMap pour la Belgique : une couleur par province (+ Région de
// Bruxelles-Capitale), sur son propre geojson (ensureBelgiumGeo). Pas de pays voisins affichés ici
// (contrairement à drawFranceMap) : la Belgique n'a pas besoin de ce contexte supplémentaire, la
// France y figurant déjà comme voisin sur SA propre carte.
export async function drawBelgiumMap(byBeProvince) {
    const container = d3.select('#belgiumMapChart');
    showMapMessage('belgiumMapChart', 'Chargement de la carte de Belgique…');

    let geojsonRaw;
    try {
        geojsonRaw = await ensureBelgiumGeo();
    } catch(err) {
        showMapMessage('belgiumMapChart', 'Impossible de charger la carte de Belgique (connexion internet requise).', true);
        return;
    }
    if(!document.getElementById('belgiumMapChart')) return;
    const features = geojsonRaw.features;

    container.selectAll('*').remove();
    const width = container.node().clientWidth || 500, height = 420;
    const svg = container.append('svg').attr('width', width).attr('height', height);

    // fitExtent (et non un centrage manuel comme pour drawFranceMap) : suffisant en l'absence de
    // pays voisins à cadrer autour, et évite d'avoir à calibrer une projection à la main pour un
    // territoire dont l'étendue est fixe et connue (contrairement à un contour choisi dynamiquement).
    const projection = d3.geoMercator().fitExtent([[16, 16], [width - 16, height - 16]], { type: 'FeatureCollection', features });
    const path = d3.geoPath().projection(projection);
    const maxCount = d3.max(Object.values(byBeProvince)) || 1;
    const colorScale = d3.scaleSequentialSqrt(d3.interpolateBlues).domain([0, maxCount]);

    const tooltip = document.getElementById('tooltip');

    svg.selectAll('path.province')
        .data(features)
        .join('path')
        .attr('class', 'province')
        .attr('d', path)
        .attr('fill', d => { const c = byBeProvince[d.properties.AdPrKey] || 0; return c > 0 ? colorScale(c) : '#f0f0f0'; })
        .attr('stroke', '#555')
        .attr('stroke-width', 0.8)
        .style('cursor', 'default')
        .on('mouseover', function(e, d) {
            const count = byBeProvince[d.properties.AdPrKey] || 0;
            d3.select(this).attr('stroke', '#0055A4').attr('stroke-width', 2);
            tooltip.style.opacity = 1;
            tooltip.innerHTML = `<strong>${d.properties.NameFRE || d.properties.AdPrKey}</strong><div class="tt-row"><span>Occurrences</span><span>${count}</span></div>`;
        })
        .on('mousemove', e => {
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('stroke', '#555').attr('stroke-width', 0.8);
            tooltip.style.opacity = 0;
        });

    const legendWidth = 180, legendHeight = 12;
    const legendX = width - legendWidth - 20, legendY = height - 34;
    const gradientId = 'belgiumMapGradient';
    const gradient = svg.append('defs').append('linearGradient')
        .attr('id', gradientId).attr('x1', '0%').attr('x2', '100%').attr('y1', '0%').attr('y2', '0%');
    const stopCount = 10;
    for(let i = 0; i <= stopCount; i++) {
        const t = i / stopCount;
        gradient.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorScale(t * maxCount));
    }
    const legend = svg.append('g').attr('transform', `translate(${legendX},${legendY})`);
    legend.append('text').attr('x', 0).attr('y', -6).style('font-size', '10px').style('font-weight', 'bold').style('fill', '#333')
        .text('Occurrences par province');
    legend.append('rect').attr('width', legendWidth).attr('height', legendHeight)
        .style('fill', `url(#${gradientId})`).attr('stroke', '#999').attr('stroke-width', 0.5);
    const legendScale = d3.scaleLinear().domain([0, maxCount]).range([0, legendWidth]);
    legend.append('g').attr('transform', `translate(0,${legendHeight})`)
        .call(d3.axisBottom(legendScale).tickValues(niceIntegerTicks(maxCount, 4)).tickFormat(d3.format('d')))
        .selectAll('text').style('font-size', '9px');
}

// --- CARTE PAR DÉPARTEMENT (détail d'un seul département : événements géolocalisés + patronymes) ---
// Complète la choropleth ci-dessus (une couleur par département, sur toute la France) par une vue
// zoomée sur UN département à la fois, où chaque événement individuel redevient visible (au lieu
// d'être noyé dans un total). Réutilise le même geojson (ensureFranceGeo) plutôt que d'en charger un
// spécifique par département : d3.geoConicConformal().fitExtent() zoome sur le seul contour choisi.
export const DEPT_EVENT_TYPES = {
    BIRT: { label: 'Naissance', icon: '👶', color: '#3498db' },
    DEAT: { label: 'Décès', icon: '⚰️', color: '#34495e' },
    MARR: { label: 'Mariage', icon: '💍', color: '#9b59b6' },
    RESI: { label: 'Résidence', icon: '🏠', color: '#e67e22' },
    OTHER: { label: 'Autre', icon: '📌', color: '#16a085' }
};

// Événements géolocalisables d'une personne, tous départements confondus : naissance/décès (uniques),
// premier mariage daté (voir postProcess dans gedcom.js), chaque résidence connue (tag RESI natif ou
// EVEN/FACT TYPE=Résidence — voir gedcom.js), et tout autre fait localisé (otherEvents : ADOP, GRAD,
// TITL... ou EVEN/FACT générique — voir OTHER_EVENT_TAG_LABELS dans gedcom.js), regroupés sous "Autre".
// isCens/isResi sont exclus d'"Autre" : ces faits sont DÉJÀ comptés ci-dessus via resiEvents (et
// exclus de censusEvents ici, hors-scope de cette vue) — les reprendre ferait doublon sur la carte,
// même piège que celui déjà géré par buildLifeEvents (timeline.js) pour la frise de vie.
// EMIG/IMMI restent hors-scope, centrée sur "où a vécu cette personne" plutôt que les migrations.
function personDeptEvents(p) {
    const evts = [];
    if(p.birth?.geo?.dept) evts.push({ type: 'BIRT', geo: p.birth.geo, year: p.birth.year });
    if(p.death?.geo?.dept) evts.push({ type: 'DEAT', geo: p.death.geo, year: p.death.year });
    if(p.marrGeo?.dept) evts.push({ type: 'MARR', geo: p.marrGeo, year: p.marrYear });
    (p.resiEvents || []).forEach(r => { if(r.geo?.dept) evts.push({ type: 'RESI', geo: r.geo, year: r.year }); });
    (p.otherEvents || []).forEach(oe => {
        if(oe.geo?.dept && !oe.isCens && !oe.isResi) evts.push({ type: 'OTHER', geo: oe.geo, year: oe.year, factLabel: labelForOther(oe) });
    });
    return evts;
}

// Un total d'événements par département, sur tout le fichier chargé : sert à peupler la barre de
// sélection (défilement horizontal) et à choisir le département par défaut (celui qui en a le plus).
export function computeDepartmentSummaries(list) {
    const totals = new Map();
    list.forEach(p => personDeptEvents(p).forEach(e => {
        const code = deptCode(e.geo.dept);
        if(code) totals.set(code, (totals.get(code) || 0) + 1);
    }));
    return Array.from(totals.entries())
        .map(([code, total]) => ({ code, label: GEO.deptLabels[code] || code, total }))
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'fr'));
}

// Détail d'UN département : points géolocalisés (groupés par lieu+type d'événement, pour agréger les
// événements superposés au même endroit plutôt que d'empiler des cercles identiques) et liste des
// patronymes qui y sont attachés (comptés en personnes DISTINCTES, pas en occurrences d'événement :
// une personne née ET décédée dans ce département ne doit pas compter double dans sa "liste éclair").
export function computeDepartmentDetail(list, code) {
    const pointMap = new Map();
    const surnameOwners = new Map(); // patronyme -> Set(id personne)
    let totalEvents = 0, geolocated = 0;

    list.forEach(p => {
        const evts = personDeptEvents(p).filter(e => deptCode(e.geo.dept) === code);
        if(!evts.length) return;
        totalEvents += evts.length;

        const surname = (p.surname || '').trim();
        if(surname) {
            if(!surnameOwners.has(surname)) surnameOwners.set(surname, new Set());
            surnameOwners.get(surname).add(p.id);
        }

        evts.forEach(e => {
            if(e.geo.lat == null || e.geo.lon == null) return;
            geolocated++;
            const key = `${e.type}:${e.geo.lat.toFixed(3)},${e.geo.lon.toFixed(3)}`;
            if(!pointMap.has(key)) pointMap.set(key, { type: e.type, lat: e.geo.lat, lon: e.geo.lon, city: e.geo.city || null, count: 0, items: [] });
            const pt = pointMap.get(key);
            pt.count++;
            if(pt.items.length < 30) pt.items.push({ name: p.name, year: e.year, factLabel: e.factLabel || null });
        });
    });

    const surnames = Array.from(surnameOwners.entries())
        .map(([surname, ids]) => ({ surname, count: ids.size }))
        .sort((a, b) => b.count - a.count || a.surname.localeCompare(b.surname, 'fr'));

    return {
        code, label: GEO.deptLabels[code] || code,
        totalEvents, geolocated,
        points: Array.from(pointMap.values()),
        surnames
    };
}

export async function drawDepartmentMap(containerId, code, detail) {
    const container = d3.select(`#${containerId}`);
    showMapMessage(containerId, 'Chargement de la carte…');

    let geojsonRaw;
    try {
        geojsonRaw = await ensureFranceGeo();
    } catch(err) {
        showMapMessage(containerId, 'Impossible de charger la carte (connexion internet requise).', true);
        return;
    }
    if(!document.getElementById(containerId)) return;
    const feature = geojsonRaw.features.find(f => f.properties.code === code);
    if(!feature) {
        showMapMessage(containerId, `Contour introuvable pour ce département (${detail.label}).`, true);
        return;
    }

    container.selectAll('*').remove();
    const height = 440;
    // La "liste éclair" des patronymes est dessinée EN SVG, dans une colonne à droite de la carte
    // (plutôt qu'en HTML à côté) : le bouton "copier l'image" (copySvgAsPng, utils.js) ne sérialise
    // QUE le <svg> ciblé, donc c'est le seul moyen pour qu'elle apparaisse dans l'image copiée/
    // partagée. La colonne HTML #deptSurnameList (filtrable, scrollable, non tronquée) reste la
    // référence pour un usage interactif ; celle-ci n'en est qu'un aperçu figé, plafonné à ce qui
    // tient verticalement. Sautée sous un seuil de largeur : pas la place de l'afficher lisiblement.
    const containerWidth = container.node().clientWidth || 720;
    const listWidth = containerWidth >= 560 ? 200 : 0;
    const mapWidth = containerWidth - listWidth;
    const svg = container.append('svg').attr('width', containerWidth).attr('height', height);

    const projection = d3.geoConicConformal().fitExtent([[24, 24], [mapWidth - 24, height - 24]], feature);
    const path = d3.geoPath().projection(projection);

    svg.append('path').datum(feature).attr('d', path)
        .attr('fill', '#eef3f8').attr('stroke', '#555').attr('stroke-width', 1.2);

    // Titre dessiné EN SVG (même raison que la "liste éclair", voir plus haut) : le nom du
    // département n'apparaît sinon que dans le <h3> HTML à côté, absent de l'image copiée/partagée
    // puisque copySvgAsPng (utils.js) ne sérialise que le <svg> ciblé.
    svg.append('text').attr('x', 12).attr('y', 22).style('font-size', '15px').style('font-weight', 700).style('fill', '#2c3e50')
        .text(`${detail.label} (${code})`);

    if(!detail.points.length) {
        svg.append('text').attr('x', mapWidth / 2).attr('y', height / 2).attr('text-anchor', 'middle')
            .style('font-size', '11px').style('fill', '#888')
            .text('Aucun événement précisément géolocalisé pour ce département.');
    } else {
        // Coordonnées écran calculées une fois (et non dans chaque accesseur x/y) : évite d'appeler la
        // projection deux fois par point, et permet d'écarter proprement un point que fitExtent aurait
        // malgré tout laissé hors cadre (arrondis de contour, rarissime mais silencieux sinon).
        const plotted = detail.points
            .map(p => { const xy = projection([p.lon, p.lat]); return xy ? { ...p, x: xy[0], y: xy[1] } : null; })
            .filter(Boolean);

        const maxCount = d3.max(plotted, p => p.count) || 1;
        const radius = d3.scaleSqrt().domain([1, maxCount]).range([4, 16]);
        const tooltip = document.getElementById('tooltip');

        svg.selectAll('circle.evt').data(plotted).join('circle').attr('class', 'evt')
            .attr('cx', p => p.x).attr('cy', p => p.y).attr('r', p => radius(p.count))
            .attr('fill', p => DEPT_EVENT_TYPES[p.type]?.color || '#3498db')
            .attr('fill-opacity', 0.75).attr('stroke', '#fff').attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('mouseover', function(e, p) {
                d3.select(this).attr('stroke', '#0055A4').attr('stroke-width', 2);
                const info = DEPT_EVENT_TYPES[p.type] || { label: p.type, icon: '•' };
                const shown = Math.min(15, p.items.length);
                const rows = p.items.slice(0, shown).map(it => {
                    // factLabel (surtout utile sous "Autre", voir personDeptEvents) : les faits
                    // regroupés sous ce type peuvent être de nature très différente (adoption, diplôme,
                    // fait personnalisé...) d'une personne à l'autre au même endroit, contrairement à
                    // BIRT/DEAT/MARR/RESI où le type du point suffit déjà à savoir de quoi il s'agit.
                    const label = it.factLabel ? `${escapeHtml(it.name || 'Inconnu')} — ${escapeHtml(it.factLabel)}` : escapeHtml(it.name || 'Inconnu');
                    return `<div class="tt-row"><span>${label}</span><span>${it.year != null ? it.year : ''}</span></div>`;
                }).join('');
                const more = p.count > shown ? `<div class="tt-row" style="opacity:.7;font-style:italic">…et ${p.count - shown} autre(s)</div>` : '';
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${info.icon} ${info.label}${p.city ? ' — ' + escapeHtml(p.city) : ''}</strong>
                    <div class="tt-row"><span>Occurrences</span><span>${p.count}</span></div>
                    <div style="margin-top:6px;max-height:200px;overflow-y:auto">${rows}${more}</div>`;
            })
            .on('mousemove', e => {
                tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
                tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
            })
            .on('mouseout', function() {
                d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1);
                tooltip.style.opacity = 0;
            });

        // Légende : seulement les types d'événement réellement présents sur CETTE carte (pas de bruit
        // pour un type absent), dans l'ordre fixe DEPT_EVENT_TYPES pour rester cohérent d'un
        // département à l'autre.
        const typesPresent = Object.keys(DEPT_EVENT_TYPES).filter(t => plotted.some(p => p.type === t));
        const legend = svg.append('g').attr('transform', `translate(12, ${height - 12 - typesPresent.length * 16})`);
        typesPresent.forEach((t, i) => {
            const info = DEPT_EVENT_TYPES[t];
            legend.append('circle').attr('cx', 6).attr('cy', i * 16 + 6).attr('r', 5).attr('fill', info.color);
            legend.append('text').attr('x', 16).attr('y', i * 16 + 10).style('font-size', '10px').style('fill', '#333')
                .text(`${info.icon} ${info.label}`);
        });
    }

    if(listWidth > 0) drawDeptSurnamePanel(svg, mapWidth, listWidth, height, detail.surnames);
}

// Colonne "Liste éclair" dessinée dans le <svg> de la carte (voir drawDepartmentMap) : plafonnée au
// nombre de lignes qui tiennent verticalement (rowHeight fixe), le reste résumé en "+N autres" plutôt
// que débordé hors du cadre — la liste HTML #deptSurnameList à côté reste, elle, non tronquée.
function drawDeptSurnamePanel(svg, x0, panelWidth, height, surnames) {
    svg.append('line').attr('x1', x0).attr('x2', x0).attr('y1', 10).attr('y2', height - 10).attr('stroke', '#ddd');

    const g = svg.append('g').attr('transform', `translate(${x0 + 16}, 22)`);
    g.append('text').attr('x', 0).attr('y', 0).style('font-size', '12px').style('font-weight', 700).style('fill', '#2c3e50')
        .text('📜 Liste éclair');
    g.append('text').attr('x', 0).attr('y', 15).style('font-size', '9px').style('fill', '#888')
        .text(`${surnames.length} patronyme${surnames.length > 1 ? 's' : ''}`);

    const rowHeight = 15, startY = 34, maxRows = Math.max(0, Math.floor((height - startY - 14) / rowHeight));
    const shown = surnames.slice(0, maxRows);
    const countX = panelWidth - 32;

    shown.forEach((s, i) => {
        const y = startY + i * rowHeight;
        g.append('text').attr('x', 0).attr('y', y).style('font-size', '10.5px').style('fill', '#333')
            .text(s.surname.length > 18 ? s.surname.slice(0, 17) + '…' : s.surname)
            .append('title').text(s.surname);
        g.append('text').attr('x', countX).attr('y', y).attr('text-anchor', 'end')
            .style('font-size', '10px').style('fill', '#7f8c8d').text(s.count);
    });
    if(surnames.length > shown.length) {
        g.append('text').attr('x', 0).attr('y', startY + shown.length * rowHeight)
            .style('font-size', '9px').style('font-style', 'italic').style('fill', '#999')
            .text(`+ ${surnames.length - shown.length} autre(s)`);
    }
}

// --- CARTE PAR PROVINCE BELGE (détail d'une seule province : événements géolocalisés + patronymes) ---
// Pendant de la section "CARTE PAR DÉPARTEMENT" ci-dessus, pour la Belgique : mêmes événements
// géolocalisables (personBeProvinceEvents ~ personDeptEvents), même agrégation par lieu+type, même
// panneau "Liste éclair" des patronymes (drawDeptSurnamePanel, générique — réutilisé tel quel) et
// mêmes icônes/couleurs par type d'événement (DEPT_EVENT_TYPES, générique malgré son nom).
function personBeProvinceEvents(p) {
    const evts = [];
    if(p.birth?.geo?.beProvince) evts.push({ type: 'BIRT', geo: p.birth.geo, year: p.birth.year });
    if(p.death?.geo?.beProvince) evts.push({ type: 'DEAT', geo: p.death.geo, year: p.death.year });
    if(p.marrGeo?.beProvince) evts.push({ type: 'MARR', geo: p.marrGeo, year: p.marrYear });
    (p.resiEvents || []).forEach(r => { if(r.geo?.beProvince) evts.push({ type: 'RESI', geo: r.geo, year: r.year }); });
    (p.otherEvents || []).forEach(oe => {
        if(oe.geo?.beProvince && !oe.isCens && !oe.isResi) evts.push({ type: 'OTHER', geo: oe.geo, year: oe.year, factLabel: labelForOther(oe) });
    });
    return evts;
}

export function computeBeProvinceSummaries(list) {
    const totals = new Map();
    list.forEach(p => personBeProvinceEvents(p).forEach(e => {
        const code = deptCode(e.geo.beProvince);
        if(code) totals.set(code, (totals.get(code) || 0) + 1);
    }));
    return Array.from(totals.entries())
        .map(([code, total]) => ({ code, label: GEO.beProvinceLabels[code] || code, total }))
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'fr'));
}

export function computeBeProvinceDetail(list, code) {
    const pointMap = new Map();
    const surnameOwners = new Map(); // patronyme -> Set(id personne)
    let totalEvents = 0, geolocated = 0;

    list.forEach(p => {
        const evts = personBeProvinceEvents(p).filter(e => deptCode(e.geo.beProvince) === code);
        if(!evts.length) return;
        totalEvents += evts.length;

        const surname = (p.surname || '').trim();
        if(surname) {
            if(!surnameOwners.has(surname)) surnameOwners.set(surname, new Set());
            surnameOwners.get(surname).add(p.id);
        }

        evts.forEach(e => {
            if(e.geo.lat == null || e.geo.lon == null) return;
            geolocated++;
            const key = `${e.type}:${e.geo.lat.toFixed(3)},${e.geo.lon.toFixed(3)}`;
            if(!pointMap.has(key)) pointMap.set(key, { type: e.type, lat: e.geo.lat, lon: e.geo.lon, city: e.geo.city || null, count: 0, items: [] });
            const pt = pointMap.get(key);
            pt.count++;
            if(pt.items.length < 30) pt.items.push({ name: p.name, year: e.year, factLabel: e.factLabel || null });
        });
    });

    const surnames = Array.from(surnameOwners.entries())
        .map(([surname, ids]) => ({ surname, count: ids.size }))
        .sort((a, b) => b.count - a.count || a.surname.localeCompare(b.surname, 'fr'));

    return {
        code, label: GEO.beProvinceLabels[code] || code,
        totalEvents, geolocated,
        points: Array.from(pointMap.values()),
        surnames
    };
}

export async function drawBeProvinceMap(containerId, code, detail) {
    const container = d3.select(`#${containerId}`);
    showMapMessage(containerId, 'Chargement de la carte…');

    let geojsonRaw;
    try {
        geojsonRaw = await ensureBelgiumGeo();
    } catch(err) {
        showMapMessage(containerId, 'Impossible de charger la carte (connexion internet requise).', true);
        return;
    }
    if(!document.getElementById(containerId)) return;
    const feature = geojsonRaw.features.find(f => f.properties.AdPrKey === code);
    if(!feature) {
        showMapMessage(containerId, `Contour introuvable pour cette province (${detail.label}).`, true);
        return;
    }

    container.selectAll('*').remove();
    const height = 440;
    const containerWidth = container.node().clientWidth || 720;
    const listWidth = containerWidth >= 560 ? 200 : 0;
    const mapWidth = containerWidth - listWidth;
    const svg = container.append('svg').attr('width', containerWidth).attr('height', height);

    const projection = d3.geoConicConformal().fitExtent([[24, 24], [mapWidth - 24, height - 24]], feature);
    const path = d3.geoPath().projection(projection);

    svg.append('path').datum(feature).attr('d', path)
        .attr('fill', '#eef3f8').attr('stroke', '#555').attr('stroke-width', 1.2);

    // Titre dessiné EN SVG : même raison que pour drawDepartmentMap (voir son commentaire) — absent
    // sinon de l'image copiée/partagée, qui ne sérialise que le <svg>.
    svg.append('text').attr('x', 12).attr('y', 22).style('font-size', '15px').style('font-weight', 700).style('fill', '#2c3e50')
        .text(detail.label);

    if(!detail.points.length) {
        svg.append('text').attr('x', mapWidth / 2).attr('y', height / 2).attr('text-anchor', 'middle')
            .style('font-size', '11px').style('fill', '#888')
            .text('Aucun événement précisément géolocalisé pour cette province.');
    } else {
        const plotted = detail.points
            .map(p => { const xy = projection([p.lon, p.lat]); return xy ? { ...p, x: xy[0], y: xy[1] } : null; })
            .filter(Boolean);

        const maxCount = d3.max(plotted, p => p.count) || 1;
        const radius = d3.scaleSqrt().domain([1, maxCount]).range([4, 16]);
        const tooltip = document.getElementById('tooltip');

        svg.selectAll('circle.evt').data(plotted).join('circle').attr('class', 'evt')
            .attr('cx', p => p.x).attr('cy', p => p.y).attr('r', p => radius(p.count))
            .attr('fill', p => DEPT_EVENT_TYPES[p.type]?.color || '#3498db')
            .attr('fill-opacity', 0.75).attr('stroke', '#fff').attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('mouseover', function(e, p) {
                d3.select(this).attr('stroke', '#0055A4').attr('stroke-width', 2);
                const info = DEPT_EVENT_TYPES[p.type] || { label: p.type, icon: '•' };
                const shown = Math.min(15, p.items.length);
                const rows = p.items.slice(0, shown).map(it => {
                    const label = it.factLabel ? `${escapeHtml(it.name || 'Inconnu')} — ${escapeHtml(it.factLabel)}` : escapeHtml(it.name || 'Inconnu');
                    return `<div class="tt-row"><span>${label}</span><span>${it.year != null ? it.year : ''}</span></div>`;
                }).join('');
                const more = p.count > shown ? `<div class="tt-row" style="opacity:.7;font-style:italic">…et ${p.count - shown} autre(s)</div>` : '';
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${info.icon} ${info.label}${p.city ? ' — ' + escapeHtml(p.city) : ''}</strong>
                    <div class="tt-row"><span>Occurrences</span><span>${p.count}</span></div>
                    <div style="margin-top:6px;max-height:200px;overflow-y:auto">${rows}${more}</div>`;
            })
            .on('mousemove', e => {
                tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
                tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
            })
            .on('mouseout', function() {
                d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1);
                tooltip.style.opacity = 0;
            });

        const typesPresent = Object.keys(DEPT_EVENT_TYPES).filter(t => plotted.some(p => p.type === t));
        const legend = svg.append('g').attr('transform', `translate(12, ${height - 12 - typesPresent.length * 16})`);
        typesPresent.forEach((t, i) => {
            const info = DEPT_EVENT_TYPES[t];
            legend.append('circle').attr('cx', 6).attr('cy', i * 16 + 6).attr('r', 5).attr('fill', info.color);
            legend.append('text').attr('x', 16).attr('y', i * 16 + 10).style('font-size', '10px').style('fill', '#333')
                .text(`${info.icon} ${info.label}`);
        });
    }

    if(listWidth > 0) drawDeptSurnamePanel(svg, mapWidth, listWidth, height, detail.surnames);
}

// --- CARTE EUROPE (choroplèthe par pays, zoomable sur un pays) ---
// Généralise le principe des sections "CARTE PAR DÉPARTEMENT"/"CARTE PAR PROVINCE BELGE" ci-dessus
// à l'échelle du continent, mais avec un état par défaut différent : plutôt que de zoomer d'emblée
// sur le territoire le plus représenté, la vue Europe s'ouvre sur une choroplèthe de TOUT le
// continent (une couleur par pays selon son nombre d'événements, comme drawFranceMap/drawBelgiumMap) ;
// sélectionner un pays (chip ou clic direct sur son contour) fait basculer la carte en vue "détail"
// identique à drawDepartmentMap (contour zoomé, événements géolocalisés individuels, panneau
// patronymes) — réutilise donc DEPT_EVENT_TYPES/drawDeptSurnamePanel sous une forme adaptée au pays.
// Limité aux pays "actuels" de l'Europe géographique reconnus par GEO.countryMap : ni la Russie ni
// la Turquie (transcontinentales, l'essentiel de leur territoire est hors d'Europe — les inclure
// avec leur géométrie Natural Earth complète, non découpée à l'Oural/au Bosphore, fausserait
// l'échelle de la vue "Europe entière").
const EUROPE_COUNTRY_LABELS = new Map([
    ['France', 'France'], ['Belgium', 'Belgique'], ['Switzerland', 'Suisse'], ['Germany', 'Allemagne'],
    ['Italy', 'Italie'], ['Spain', 'Espagne'], ['United Kingdom', 'Royaume-Uni'], ['Ireland', 'Irlande'],
    ['Andorra', 'Andorre'], ['Luxembourg', 'Luxembourg'], ['Netherlands', 'Pays-Bas'], ['Austria', 'Autriche'],
    ['Portugal', 'Portugal'], ['Monaco', 'Monaco'], ['Liechtenstein', 'Liechtenstein'], ['Sweden', 'Suède'],
    ['Norway', 'Norvège'], ['Denmark', 'Danemark'], ['Finland', 'Finlande'], ['Iceland', 'Islande'],
    ['Poland', 'Pologne'], ['Czechia', 'Tchéquie'], ['Czech Republic', 'Tchéquie'], ['Slovakia', 'Slovaquie'],
    ['Hungary', 'Hongrie'], ['Romania', 'Roumanie'], ['Bulgaria', 'Bulgarie'], ['Serbia', 'Serbie'],
    ['Croatia', 'Croatie'], ['Slovenia', 'Slovénie'], ['Bosnia and Herzegovina', 'Bosnie'],
    ['Montenegro', 'Monténégro'], ['Macedonia', 'Macédoine'], ['North Macedonia', 'Macédoine'],
    ['Albania', 'Albanie'], ['Greece', 'Grèce'], ['Cyprus', 'Chypre'], ['Malta', 'Malte'],
    ['Ukraine', 'Ukraine'], ['Belarus', 'Biélorussie'], ['Moldova', 'Moldavie'], ['Lithuania', 'Lituanie'],
    ['Latvia', 'Lettonie'], ['Estonia', 'Estonie']
]);
function europeCountryLabel(f) {
    const name = f.properties?.ADMIN || f.properties?.NAME || f.properties?.name || f.properties?.NAME_EN || '';
    return EUROPE_COUNTRY_LABELS.get(name) || null;
}
// Ensemble des libellés (valeurs GEO.countryMap) couverts par la vue Europe : restreint les
// événements considérés (voir personEuropeEvents) aux seuls pays du continent — un GEDCOM peut
// aussi contenir des lieux hors d'Europe (USA, Canada...), déjà comptés ailleurs (carte du monde).
const EUROPE_LABELS_SET = new Set(EUROPE_COUNTRY_LABELS.values());

// Événements géolocalisables d'une personne, restreints aux pays européens reconnus : même liste
// d'événements que personDeptEvents/personBeProvinceEvents (naissance/décès/mariage/résidences/
// autres faits localisés), filtrée sur geo.country plutôt que geo.dept/geo.beProvince.
function personEuropeEvents(p) {
    const evts = [];
    if(p.birth?.geo?.country) evts.push({ type: 'BIRT', geo: p.birth.geo, year: p.birth.year });
    if(p.death?.geo?.country) evts.push({ type: 'DEAT', geo: p.death.geo, year: p.death.year });
    if(p.marrGeo?.country) evts.push({ type: 'MARR', geo: p.marrGeo, year: p.marrYear });
    (p.resiEvents || []).forEach(r => { if(r.geo?.country) evts.push({ type: 'RESI', geo: r.geo, year: r.year }); });
    (p.otherEvents || []).forEach(oe => {
        if(oe.geo?.country && !oe.isCens && !oe.isResi) evts.push({ type: 'OTHER', geo: oe.geo, year: oe.year, factLabel: labelForOther(oe) });
    });
    return evts.filter(e => EUROPE_LABELS_SET.has(e.geo.country));
}

export function computeEuropeCountrySummaries(list) {
    const totals = new Map();
    list.forEach(p => personEuropeEvents(p).forEach(e => {
        totals.set(e.geo.country, (totals.get(e.geo.country) || 0) + 1);
    }));
    return Array.from(totals.entries())
        .map(([label, total]) => ({ code: label, label, total }))
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'fr'));
}

// code === null : agrège tous les pays européens (pseudo-territoire "Europe entière"), pour les
// cartes-statistiques de la vue d'ensemble avant toute sélection de pays.
export function computeEuropeDetail(list, code) {
    const pointMap = new Map();
    const surnameOwners = new Map(); // patronyme -> Set(id personne)
    let totalEvents = 0, geolocated = 0;

    list.forEach(p => {
        const evts = personEuropeEvents(p).filter(e => code === null || e.geo.country === code);
        if(!evts.length) return;
        totalEvents += evts.length;

        const surname = (p.surname || '').trim();
        if(surname) {
            if(!surnameOwners.has(surname)) surnameOwners.set(surname, new Set());
            surnameOwners.get(surname).add(p.id);
        }

        evts.forEach(e => {
            if(e.geo.lat == null || e.geo.lon == null) return;
            geolocated++;
            const key = `${e.type}:${e.geo.lat.toFixed(3)},${e.geo.lon.toFixed(3)}`;
            if(!pointMap.has(key)) pointMap.set(key, { type: e.type, lat: e.geo.lat, lon: e.geo.lon, city: e.geo.city || null, count: 0, items: [] });
            const pt = pointMap.get(key);
            pt.count++;
            if(pt.items.length < 30) pt.items.push({ name: p.name, year: e.year, factLabel: e.factLabel || null });
        });
    });

    const surnames = Array.from(surnameOwners.entries())
        .map(([surname, ids]) => ({ surname, count: ids.size }))
        .sort((a, b) => b.count - a.count || a.surname.localeCompare(b.surname, 'fr'));

    return {
        code, label: code || 'Europe',
        totalEvents, geolocated,
        points: Array.from(pointMap.values()),
        surnames
    };
}

// Bbox grossière de l'Europe continentale (îles atlantiques proches incluses : Islande...), utilisée
// pour retirer les territoires d'outre-mer très éloignés qu'un pays comme la France (Guyane, Amérique
// du Sud) ou l'Espagne (Canaries, au large de l'Afrique) embarque dans le MÊME feature Natural Earth
// que son territoire européen. Sans ce filtre, fitExtent() engloberait ces exclaves lointaines dans le
// calcul du cadrage et réduirait le territoire européen à un minuscule point dans un coin de la carte
// (cas vécu : la Guyane faisait apparaître la France entière comme un point microscopique).
const EUROPE_BBOX = { lonMin: -25, lonMax: 45, latMin: 34, latMax: 72 };
function partCentroid(ring) {
    let sx = 0, sy = 0;
    ring.forEach(([x, y]) => { sx += x; sy += y; });
    return [sx / ring.length, sy / ring.length];
}
function inEuropeBbox([lon, lat]) {
    return lon >= EUROPE_BBOX.lonMin && lon <= EUROPE_BBOX.lonMax && lat >= EUROPE_BBOX.latMin && lat <= EUROPE_BBOX.latMax;
}
// Retire, d'une géométrie Polygon/MultiPolygon, les "morceaux" (anneau extérieur + trous) dont le
// centroïde de l'anneau extérieur tombe hors de la bbox Europe ci-dessus. Garde tout si AUCUN morceau
// n'est dans la bbox (filet de sécurité), pour ne jamais produire une géométrie vide.
function clipToEuropeBbox(geometry) {
    if(!geometry) return geometry;
    const parts = geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : null;
    if(!parts) return geometry;
    let kept = parts.filter(part => inEuropeBbox(partCentroid(part[0])));
    if(!kept.length) kept = parts;
    return { type: 'MultiPolygon', coordinates: kept };
}

// Emprise lon/lat calculée directement en parcourant TOUS les points de TOUS les anneaux (extérieurs
// ET trous, peu importe) d'une liste de features — volontairement sans passer par d3.geoBounds ni par
// fitExtent : voir le commentaire dans drawEuropeCountryDetail, cette voie détournée existe
// précisément parce que le calcul d'emprise "normal" de d3-geo se comporte mal sur certaines
// géométries de ce fichier (constaté sur l'Andorre). Un simple min/max de coordonnées ne peut pas, lui,
// se tromper sur "quel côté est l'intérieur" : il n'a aucune notion de sens de parcours.
function rawLonLatBounds(features) {
    let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
    const visitRing = ring => ring.forEach(([lon, lat]) => {
        if(lon < lonMin) lonMin = lon;
        if(lon > lonMax) lonMax = lon;
        if(lat < latMin) latMin = lat;
        if(lat > latMax) latMax = lat;
    });
    features.forEach(f => {
        const g = f.geometry;
        if(!g) return;
        if(g.type === 'Polygon') g.coordinates.forEach(visitRing);
        else if(g.type === 'MultiPolygon') g.coordinates.forEach(poly => poly.forEach(visitRing));
    });
    return { lonMin, lonMax, latMin, latMax };
}

// Construit, à partir d'une emprise rawLonLatBounds, un simple rectangle GeoJSON (anneau CCW, marge de
// 10% + plancher absolu pour ne jamais coller aux bords même sur un territoire ponctuel) : sert
// UNIQUEMENT à calibrer une projection via fitExtent (voir drawEuropeCountryDetail), jamais dessiné —
// un rectangle simple, loin de tout pôle et largement plus petit qu'un hémisphère, ne peut pas
// déclencher la même ambiguïté "intérieur/extérieur" que la géométrie réelle du territoire.
function paddedBoundsFeature(b) {
    const lonPad = Math.max((b.lonMax - b.lonMin) * 0.1, 0.05);
    const latPad = Math.max((b.latMax - b.latMin) * 0.1, 0.05);
    const lonMin = b.lonMin - lonPad, lonMax = b.lonMax + lonPad;
    const latMin = b.latMin - latPad, latMax = b.latMax + latPad;
    return {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'Polygon',
            coordinates: [[
                [lonMin, latMin], [lonMax, latMin], [lonMax, latMax], [lonMin, latMax], [lonMin, latMin]
            ]]
        }
    };
}

// --- CShapes (frontières historiques) : sous-ensemble Europe du jeu de données "CShapes 2.0" (ETH
// Zürich, icr.ethz.ch/data/cshapes), une géométrie par entité politique et par plage d'années
// [From, To] où ses frontières sont restées stables (ex. l'Allemagne y apparaît en plusieurs morceaux
// successifs : "Germany (Prussia)" avant 1871, "Germany" 1871-1945, "German Federal Republic"/
// "German Democratic Republic" pendant la partition, de nouveau "Germany" après 1990). Bundlé
// localement (assets/data/cshapes_europe.geojson, ~4,5 Mo) plutôt que rechargé depuis icr.ethz.ch à
// chaque session : évite une dépendance à la disponibilité/CORS de ce serveur pour un fichier qui ne
// change pas assez souvent pour justifier un chargement dynamique. Couvre 1806-2023 ; sa géométrie
// est déjà cadrée sur l'Europe (pas d'exclaves d'outre-mer, contrairement à Natural Earth — voir
// clipToEuropeBbox ci-dessus, dont ce fichier n'a donc pas besoin).
let cshapesEuropeCache = null;
export async function ensureCShapesEurope() {
    if(!cshapesEuropeCache) {
        const res = await fetch('./assets/data/cshapes_europe.geojson');
        // Pas de correctif de sens des anneaux ici (contrairement à ensureBelgiumGeo) : essayé, mais
        // ça a empiré le rendu au lieu de le corriger (l'aperçu Europe entière et les pays de taille
        // normale, qui s'affichaient correctement, sont devenus eux aussi des demi-disques) — donc
        // CE fichier n'a pas le même problème que "Belgium-Geographic-Data" malgré le symptôme
        // superficiellement similaire sur l'Andorre. Cause réelle probable : projection conique
        // (voir drawEuropeCountryDetail) mal adaptée à un fitExtent extrême sur un territoire minuscule,
        // pas le sens des anneaux — à corriger côté projection plutôt qu'ici.
        cshapesEuropeCache = await res.json();
    }
    return cshapesEuropeCache;
}
export function cshapesYearBounds(cshapesGeo) {
    let min = Infinity, max = -Infinity;
    cshapesGeo.features.forEach(f => {
        min = Math.min(min, f.properties.From);
        max = Math.max(max, f.properties.To);
    });
    return { min, max };
}
// Correspondance entité politique historique (CShapes "Name") -> libellé pays moderne (valeurs de
// EUROPE_COUNTRY_LABELS ci-dessus), utilisée pour colorer la vue "Europe entière" à une année donnée
// selon les MÊMES données (computeEuropeCountrySummaries) que la vue actuelle — un événement compté
// sous "Allemagne" éclaire aussi bien le territoire prussien de 1850 que la RFA de 1970. Volontairement
// absente pour les entités à héritiers multiples (Austro-Hongrie, Tchécoslovaquie, Yougoslavie, Empire
// ottoman, Russie...) : mieux vaut aucune couleur qu'une couleur trompeuse répartie arbitrairement.
const CSHAPES_NAME_TO_LABEL = new Map([
    ['Albania', 'Albanie'], ['Andorra', 'Andorre'],
    ['Anhalt', 'Allemagne'], ['Anhalt-Bernberg', 'Allemagne'], ['Anhalt-Dessau', 'Allemagne'],
    ['Austria', 'Autriche'],
    ['Baden', 'Allemagne'], ['Bavaria', 'Allemagne'],
    ['Belarus (Byelorussia)', 'Biélorussie'], ['Belgium', 'Belgique'],
    ['Bosnia', 'Bosnie'], ['Bosnia-Herzegovina', 'Bosnie'], ['Herzegovina', 'Bosnie'],
    ['Bremen', 'Allemagne'], ['Bulgaria', 'Bulgarie'],
    ['Croatia', 'Croatie'], ['Czech Republic', 'Tchéquie'],
    ['Denmark', 'Danemark'], ['Estonia', 'Estonie'], ['Finland', 'Finlande'],
    ['France', 'France'], ['Frankfurt', 'Allemagne'],
    ['German Democratic Republic', 'Allemagne'], ['German Federal Republic', 'Allemagne'],
    ['Germany', 'Allemagne'], ['Germany (Prussia)', 'Allemagne'],
    ['Greece', 'Grèce'], ['Hanover', 'Allemagne'],
    ['Hesse-Darmstadt (Ducal', 'Allemagne'], ['Hesse-Homburg', 'Allemagne'], ['Hesse-Kassel (Electoral)', 'Allemagne'],
    ['Hohengeroldseck', 'Allemagne'], ['Hohenzollern-Hechingen', 'Allemagne'], ['Hohenzollern-Sigmaringen', 'Allemagne'],
    ['Hungary', 'Hongrie'], ['Iceland', 'Islande'], ['Ireland', 'Irlande'],
    ['Italy', 'Italie'], ['Italy/Sardinia', 'Italie'], ['Kingdom of Naples', 'Italie'],
    ['Latvia', 'Lettonie'], ['Liechtenstein', 'Liechtenstein'],
    ['Lippe-Detmold', 'Allemagne'], ['Lithuania', 'Lituanie'], ['Lucca', 'Italie'], ['Luxembourg', 'Luxembourg'],
    ['Macedonia (FYROM/North Macedonia)', 'Macédoine'], ['Malta', 'Malte'], ['Massa', 'Italie'],
    ['Mecklenburg-Schwerin', 'Allemagne'], ['Mecklenburg-Strelitz', 'Allemagne'], ['Modena', 'Italie'],
    ['Moldova', 'Moldavie'], ['Monaco', 'Monaco'], ['Montenegro', 'Monténégro'],
    ['Nassau', 'Allemagne'], ['Netherlands', 'Pays-Bas'], ['Norway', 'Norvège'], ['Oldenburg', 'Allemagne'],
    ['Papal States', 'Italie'], ['Parma', 'Italie'], ['Piedmont', 'Italie'],
    ['Poland', 'Pologne'], ['Portugal', 'Portugal'],
    ['Reuss', 'Allemagne'], ['Romania', 'Roumanie'], ['Rumania', 'Roumanie'],
    ['Saxe-Altenburg', 'Allemagne'], ['Saxe-Coburg-Gotha', 'Allemagne'], ['Saxe-Coburg-Saalfeld', 'Allemagne'],
    ['Saxe-Gotha-Altenberg', 'Allemagne'], ['Saxe-Hildburgchausen', 'Allemagne'], ['Saxe-Meiningen', 'Allemagne'],
    ['Saxe-Weimar', 'Allemagne'], ['Saxony', 'Allemagne'], ['Schaumburg Lippe', 'Allemagne'],
    ['Serbia', 'Serbie'], ['Slovakia', 'Slovaquie'], ['Slovenia', 'Slovénie'],
    ['Spain', 'Espagne'], ['Sweden', 'Suède'], ['Switzerland', 'Suisse'],
    ['Ukraine', 'Ukraine'], ['United Kingdom', 'Royaume-Uni'],
    ['Waldeck', 'Allemagne'], ['Wolfenbuttel', 'Allemagne'], ['Württemberg', 'Allemagne']
]);

// Ensemble des libellés modernes couverts par AU MOINS une entité CShapes, quelle que soit l'année
// (donc les seuls pays pour lesquels un tracé historique existe un jour) : sert à décider, dans la
// vue détail d'un pays, s'il faut chercher un tracé CShapes ou basculer directement sur Natural
// Earth. Seul absent notable : Chypre (hors du périmètre du jeu de données CShapes-Europe).
const CSHAPES_MAPPED_LABELS = new Set(CSHAPES_NAME_TO_LABEL.values());

// code === null -> vue d'ensemble à une ANNÉE donnée (opts.year, frontières CShapes). Sinon -> vue
// détail zoomée sur CE pays, à la MÊME année : cherche toutes les entités CShapes rattachées à ce
// libellé moderne (voir CSHAPES_NAME_TO_LABEL) et actives cette année-là — un pays comme l'Allemagne
// ou l'Italie avant son unification apparaît alors comme la mosaïque des royaumes/duchés qui le
// composaient à l'époque. Repli sur le contour actuel (Natural Earth, débarrassé de ses exclaves
// d'outre-mer par clipToEuropeBbox) quand aucune entité CShapes ne correspond : soit parce que ce
// pays n'existait pas encore sous cette forme à l'année choisie (ex. Belgique avant 1830), soit parce
// qu'il est hors du jeu de données CShapes-Europe pour toute année (seul cas : Chypre).
// Cliquer un territoire rattaché aux données (vue d'ensemble uniquement, voir CSHAPES_NAME_TO_LABEL)
// appelle opts.onSelectCountry. opts.summaries (résultat de computeEuropeCountrySummaries) alimente
// la coloration de la vue d'ensemble ; opts.detail (résultat de computeEuropeDetail) alimente les
// événements géolocalisés + patronymes de la vue détail d'un pays (inchangés quelle que soit
// l'année : ils sont déjà classés sous le libellé du pays tel qu'écrit dans les actes).
export async function drawEuropeMap(containerId, code, opts = {}) {
    const container = d3.select(`#${containerId}`);
    showMapMessage(containerId, 'Chargement de la carte…');

    let cshapesGeo;
    try {
        cshapesGeo = await ensureCShapesEurope();
    } catch(err) {
        showMapMessage(containerId, 'Impossible de charger la carte (fichier de frontières historiques introuvable).', true);
        return;
    }
    if(!document.getElementById(containerId)) return;
    const bounds = cshapesYearBounds(cshapesGeo);
    const year = opts.year != null ? Math.min(Math.max(opts.year, bounds.min), bounds.max) : bounds.max;

    if(code === null) {
        const features = cshapesGeo.features.filter(f => f.properties.From <= year && f.properties.To >= year);
        drawEuropeOverview(container, features, opts.summaries || [], year, bounds, opts.onSelectCountry);
        return;
    }

    let features = cshapesGeo.features.filter(f =>
        CSHAPES_NAME_TO_LABEL.get(f.properties.Name) === code && f.properties.From <= year && f.properties.To >= year);
    const usingHistorical = features.length > 0;

    if(!features.length) {
        let europeGeo;
        try {
            europeGeo = await ensureEuropeGeo();
        } catch(err) {
            showMapMessage(containerId, 'Impossible de charger la carte (connexion internet requise).', true);
            return;
        }
        if(!document.getElementById(containerId)) return;
        const neFeature = europeGeo.features.find(f => europeCountryLabel(f) === code);
        if(!neFeature) {
            showMapMessage(containerId, `Contour introuvable pour ce pays (${code}).`, true);
            return;
        }
        features = [{ ...neFeature, geometry: clipToEuropeBbox(neFeature.geometry) }];
    }

    drawEuropeCountryDetail(container, features, opts.detail, { year, bounds, usingHistorical, hasAnyHistory: CSHAPES_MAPPED_LABELS.has(code) });
}

function drawEuropeOverview(container, features, summaries, year, bounds, onSelectCountry) {
    container.selectAll('*').remove();
    const width = container.node().clientWidth || 500, height = 460;
    const svg = container.append('svg').attr('width', width).attr('height', height);

    // fitExtent sur les entités visibles CETTE année-là (varie peu d'une année à l'autre en pratique,
    // le contour combiné restant compact — Islande-Ottomans, Portugal-Russie exclue).
    const projection = d3.geoConicConformal().fitExtent([[16, 16], [width - 16, height - 16]], { type: 'FeatureCollection', features });
    const path = d3.geoPath().projection(projection);
    const totals = {};
    summaries.forEach(s => { totals[s.code] = s.total; });
    const maxCount = Math.max(1, ...Object.values(totals));
    const colorScale = d3.scaleSequentialSqrt(d3.interpolateBlues).domain([0, maxCount]);
    const tooltip = document.getElementById('tooltip');

    svg.selectAll('path.country')
        .data(features)
        .join('path')
        .attr('class', 'country')
        .attr('d', path)
        .attr('fill', d => {
            const label = CSHAPES_NAME_TO_LABEL.get(d.properties.Name);
            const c = label ? (totals[label] || 0) : 0;
            return c > 0 ? colorScale(c) : '#f0f0f0';
        })
        .attr('stroke', '#555')
        .attr('stroke-width', 0.8)
        .style('cursor', d => CSHAPES_NAME_TO_LABEL.has(d.properties.Name) ? 'pointer' : 'default')
        .on('mouseover', function(e, d) {
            const label = CSHAPES_NAME_TO_LABEL.get(d.properties.Name);
            const count = label ? (totals[label] || 0) : 0;
            d3.select(this).attr('stroke', '#0055A4').attr('stroke-width', 2);
            tooltip.style.opacity = 1;
            tooltip.innerHTML = `<strong>${escapeHtml(d.properties.Name)}</strong>` +
                (label ? `<div class="tt-row"><span>Occurrences (${escapeHtml(label)})</span><span>${count}</span></div>`
                       : `<div class="tt-row" style="opacity:.7;font-style:italic"><span>Non rattaché aux données</span></div>`);
        })
        .on('mousemove', e => {
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('stroke', '#555').attr('stroke-width', 0.8);
            tooltip.style.opacity = 0;
        })
        .on('click', (e, d) => {
            const label = CSHAPES_NAME_TO_LABEL.get(d.properties.Name);
            if(label && onSelectCountry) onSelectCountry(label);
        });

    const legendWidth = 180, legendHeight = 12;
    const legendX = width - legendWidth - 20, legendY = height - 34;
    const gradientId = 'europeMapGradient';
    const gradient = svg.append('defs').append('linearGradient')
        .attr('id', gradientId).attr('x1', '0%').attr('x2', '100%').attr('y1', '0%').attr('y2', '0%');
    const stopCount = 10;
    for(let i = 0; i <= stopCount; i++) {
        const t = i / stopCount;
        gradient.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorScale(t * maxCount));
    }
    const legend = svg.append('g').attr('transform', `translate(${legendX},${legendY})`);
    legend.append('text').attr('x', 0).attr('y', -6).style('font-size', '10px').style('font-weight', 'bold').style('fill', '#333')
        .text('Occurrences par pays');
    legend.append('rect').attr('width', legendWidth).attr('height', legendHeight)
        .style('fill', `url(#${gradientId})`).attr('stroke', '#999').attr('stroke-width', 0.5);
    const legendScale = d3.scaleLinear().domain([0, maxCount]).range([0, legendWidth]);
    legend.append('g').attr('transform', `translate(0,${legendHeight})`)
        .call(d3.axisBottom(legendScale).tickValues(niceIntegerTicks(maxCount, 4)).tickFormat(d3.format('d')))
        .selectAll('text').style('font-size', '9px');

    svg.append('text').attr('x', 12).attr('y', 22).style('font-size', '10px').style('fill', '#888')
        .text(year >= bounds.max
            ? `Frontières actuelles (${year}) — cliquez sur un pays pour zoomer sur ses événements.`
            : `Frontières historiques en ${year} — cliquez sur un territoire rattaché aux données pour zoomer.`);
}

// Pendant de drawDepartmentMap, pour un pays européen : contour zoomé (fitExtent sur TOUTES les
// entités reçues à la fois — un pays fragmenté en plusieurs royaumes/duchés historiques à l'année
// choisie, voir drawEuropeMap ci-dessus, s'affiche donc comme leur mosaïque complète) + événements
// individuels géolocalisés + panneau "Liste éclair" des patronymes (réutilise drawDeptSurnamePanel,
// générique malgré son nom).
function drawEuropeCountryDetail(container, features, detail, yearInfo) {
    container.selectAll('*').remove();
    const height = 440;
    const containerWidth = container.node().clientWidth || 720;
    const listWidth = containerWidth >= 560 ? 200 : 0;
    const mapWidth = containerWidth - listWidth;
    const svg = container.append('svg').attr('width', containerWidth).attr('height', height);

    // fitExtent PAS calibré directement sur "features" (contrairement à toutes les autres cartes de
    // ce fichier) : pour au moins un micro-État (Andorre, constaté), fitExtent(extent, features)
    // produit un scale/translate aberrant — la carte se retrouve remplie d'une forme géométrique
    // simple (demi-disque avec une projection conique, rectangle plein bord à bord avec Mercator)
    // sans rapport avec le contour réel, quelle que soit la projection utilisée. Signe que le bug est
    // dans le calcul d'emprise de fitExtent sur CETTE géométrie précise (peut-être liée au sens des
    // anneaux, une piste déjà tentée sans succès - voir ensureCShapesEurope), pas dans la projection
    // elle-même. Contournement : calculer l'emprise nous-mêmes, directement sur les coordonnées
    // brutes (sans passer par le pipeline de clipping de d3-geo), et ne s'en servir que pour calibrer
    // la projection — la géométrie réelle n'est utilisée que pour LE DESSIN, une fois la projection
    // déjà calibrée sur une emprise saine.
    const rawBounds = rawLonLatBounds(features);
    const projection = d3.geoMercator().fitExtent([[24, 24], [mapWidth - 24, height - 24]], paddedBoundsFeature(rawBounds));
    const path = d3.geoPath().projection(projection);
    const territoryTooltip = document.getElementById('tooltip');

    // Un <path> par entité plutôt qu'un seul chemin fusionné : quand le pays est fragmenté (ex.
    // "Allemagne" en 1900 = Prusse + Bavière + Saxe + ...), chaque morceau garde son survol propre
    // (nom de l'entité historique précise) au lieu d'un simple contour muet.
    svg.selectAll('path.territory')
        .data(features)
        .join('path')
        .attr('class', 'territory')
        .attr('d', path)
        .attr('fill', '#eef3f8')
        .attr('stroke', '#555')
        .attr('stroke-width', 1.2)
        .on('mouseover', function(e, d) {
            d3.select(this).attr('stroke', '#0055A4').attr('stroke-width', 2);
            territoryTooltip.style.opacity = 1;
            territoryTooltip.innerHTML = `<strong>${escapeHtml(d.properties?.Name || detail.label)}</strong>`;
        })
        .on('mousemove', e => {
            territoryTooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            territoryTooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('stroke', '#555').attr('stroke-width', 1.2);
            territoryTooltip.style.opacity = 0;
        });

    svg.append('text').attr('x', 12).attr('y', 22).style('font-size', '15px').style('font-weight', 700).style('fill', '#2c3e50')
        .text(detail.label);

    if(yearInfo) {
        const caption = yearInfo.usingHistorical
            ? (yearInfo.year >= yearInfo.bounds.max
                ? `Frontières actuelles (${yearInfo.year})`
                : `Frontières historiques en ${yearInfo.year}${features.length > 1 ? ` (${features.length} entités)` : ''}`)
            : (yearInfo.hasAnyHistory
                ? `Frontières actuelles — pas de tracé historique pour ce pays en ${yearInfo.year}`
                : `Frontières actuelles (pays hors du jeu de données historique)`);
        svg.append('text').attr('x', 12).attr('y', 38).style('font-size', '10px').style('fill', '#888')
            .text(caption);
    }

    if(!detail.points.length) {
        svg.append('text').attr('x', mapWidth / 2).attr('y', height / 2).attr('text-anchor', 'middle')
            .style('font-size', '11px').style('fill', '#888')
            .text('Aucun événement précisément géolocalisé pour ce pays.');
    } else {
        const plotted = detail.points
            .map(p => { const xy = projection([p.lon, p.lat]); return xy ? { ...p, x: xy[0], y: xy[1] } : null; })
            .filter(Boolean);

        const maxCount = d3.max(plotted, p => p.count) || 1;
        const radius = d3.scaleSqrt().domain([1, maxCount]).range([4, 16]);
        const tooltip = document.getElementById('tooltip');

        svg.selectAll('circle.evt').data(plotted).join('circle').attr('class', 'evt')
            .attr('cx', p => p.x).attr('cy', p => p.y).attr('r', p => radius(p.count))
            .attr('fill', p => DEPT_EVENT_TYPES[p.type]?.color || '#3498db')
            .attr('fill-opacity', 0.75).attr('stroke', '#fff').attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .on('mouseover', function(e, p) {
                d3.select(this).attr('stroke', '#0055A4').attr('stroke-width', 2);
                const info = DEPT_EVENT_TYPES[p.type] || { label: p.type, icon: '•' };
                const shown = Math.min(15, p.items.length);
                const rows = p.items.slice(0, shown).map(it => {
                    const label = it.factLabel ? `${escapeHtml(it.name || 'Inconnu')} — ${escapeHtml(it.factLabel)}` : escapeHtml(it.name || 'Inconnu');
                    return `<div class="tt-row"><span>${label}</span><span>${it.year != null ? it.year : ''}</span></div>`;
                }).join('');
                const more = p.count > shown ? `<div class="tt-row" style="opacity:.7;font-style:italic">…et ${p.count - shown} autre(s)</div>` : '';
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${info.icon} ${info.label}${p.city ? ' — ' + escapeHtml(p.city) : ''}</strong>
                    <div class="tt-row"><span>Occurrences</span><span>${p.count}</span></div>
                    <div style="margin-top:6px;max-height:200px;overflow-y:auto">${rows}${more}</div>`;
            })
            .on('mousemove', e => {
                tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
                tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
            })
            .on('mouseout', function() {
                d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1);
                tooltip.style.opacity = 0;
            });

        const typesPresent = Object.keys(DEPT_EVENT_TYPES).filter(t => plotted.some(p => p.type === t));
        const legend = svg.append('g').attr('transform', `translate(12, ${height - 12 - typesPresent.length * 16})`);
        typesPresent.forEach((t, i) => {
            const info = DEPT_EVENT_TYPES[t];
            legend.append('circle').attr('cx', 6).attr('cy', i * 16 + 6).attr('r', 5).attr('fill', info.color);
            legend.append('text').attr('x', 16).attr('y', i * 16 + 10).style('font-size', '10px').style('fill', '#333')
                .text(`${info.icon} ${info.label}`);
        });
    }

    if(listWidth > 0) drawDeptSurnamePanel(svg, mapWidth, listWidth, height, detail.surnames);
}

// --- GRAPHIQUES DÉMOGRAPHIQUES (pyramide des âges, tendances par décennie) ---
// Ces graphiques portent toujours sur l'ensemble du fichier chargé, indépendamment
// des filtres (lieux/ascendants) qui ne s'appliquent qu'aux deux cartes ci-dessus.

// Liste des décennies (de décès) disponibles pour la pyramide des âges, triée croissante.
export function getPyramidDecades(list) {
    const years = list
        .filter(i => i.death?.year && i.ageDeath != null && (i.sex === 'M' || i.sex === 'F'))
        .map(i => i.death.year);
    if(!years.length) return [];
    const minD = decadeOf(d3.min(years)), maxD = decadeOf(d3.max(years));
    const decades = [];
    for(let d = minD; d <= maxD; d += 10) decades.push(d);
    return decades;
}

export function drawAgePyramid(data) {
    const container = d3.select('#ageChartPyramid');
    container.selectAll('*').remove();

    if(!data.length) {
        container.append('div').attr('class', 'map-placeholder').text('Aucune donnée pour cette période (âge au décès et sexe requis).');
        return;
    }

    const binSize = 5, maxAge = 100;
    const bins = [];
    for(let a = 0; a < maxAge; a += binSize) bins.push({ label: `${a}-${a + binSize - 1}`, from: a, to: a + binSize - 1, M: 0, F: 0 });
    bins.push({ label: '100+', from: 100, to: Infinity, M: 0, F: 0 });

    data.forEach(i => {
        const age = Math.max(0, i.ageDeath);
        const bin = bins.find(b => age >= b.from && age <= b.to) || bins[bins.length - 1];
        bin[i.sex]++;
    });
    const usedBins = bins.filter(b => b.M > 0 || b.F > 0);

    const width = container.node().clientWidth || 800, height = 360;
    const margin = { top: 30, right: 50, bottom: 35, left: 55 };
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const maxCount = d3.max(usedBins, b => Math.max(b.M, b.F)) || 1;
    const x = d3.scaleLinear().domain([-maxCount, maxCount]).nice().range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(usedBins.map(b => b.label)).range([margin.top, height - margin.bottom]).padding(0.15);

    svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(6).tickFormat(v => Math.abs(v)));
    svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y));

    svg.selectAll('rect.male').data(usedBins).join('rect').attr('class', 'male')
        .attr('x', b => x(-b.M)).attr('y', b => y(b.label))
        .attr('width', b => x(0) - x(-b.M)).attr('height', y.bandwidth())
        .attr('fill', '#3498db');
    svg.selectAll('rect.female').data(usedBins).join('rect').attr('class', 'female')
        .attr('x', x(0)).attr('y', b => y(b.label))
        .attr('width', b => x(b.F) - x(0)).attr('height', y.bandwidth())
        .attr('fill', '#e91e8c');

    const legend = svg.append('g').attr('transform', `translate(${width / 2 - 60}, 8)`);
    legend.append('rect').attr('width', 12).attr('height', 12).attr('fill', '#3498db');
    legend.append('text').attr('x', 16).attr('y', 10).style('font-size', '11px').text('Hommes');
    legend.append('rect').attr('x', 85).attr('width', 12).attr('height', 12).attr('fill', '#e91e8c');
    legend.append('text').attr('x', 101).attr('y', 10).style('font-size', '11px').text('Femmes');
}

// Trace un graphique par décennie, une ou plusieurs séries : ligne pleine = médiane, ligne
// pointillée = moyenne, bande ombrée = 25e-75e percentile.
export function drawMeanStdChart(container, series, opts) {
    opts = opts || {};
    container.selectAll('*').remove();
    const allDecades = Array.from(new Set(series.flatMap(s => s.points.filter(p => p.median != null).map(p => p.decade)))).sort((a, b) => a - b);
    if(!allDecades.length) {
        container.append('div').attr('class', 'map-placeholder').text(opts.emptyText || 'Pas assez de données.');
        return;
    }

    const width = container.node().clientWidth || 500, height = 280;
    // Marge du haut agrandie pour laisser la place à la légende sur deux lignes (séries, puis
    // explication médiane/moyenne/corridor).
    const margin = { top: 52, right: 20, bottom: 58, left: 48 };
    const svg = container.append('svg').attr('width', width).attr('height', height);

    let yMin = Infinity, yMax = -Infinity;
    series.forEach(s => s.points.forEach(p => {
        if(p.median == null) return;
        yMin = Math.min(yMin, p.p25, p.mean);
        yMax = Math.max(yMax, p.p75, p.mean);
    }));
    yMin = Math.max(0, yMin - 2); yMax = yMax + 2;

    const x = d3.scalePoint().domain(allDecades).range([margin.left, width - margin.right]).padding(0.5);
    const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([height - margin.bottom, margin.top]);

    // Thin out tick labels when there are many decades so they don't overlap; always rotate for legibility.
    const maxLabels = Math.max(4, Math.floor((width - margin.left - margin.right) / 45));
    const labelStep = Math.max(1, Math.ceil(allDecades.length / maxLabels));
    const tickValues = allDecades.filter((d, i) => i % labelStep === 0);

    svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickValues(tickValues).tickFormat(d => `${d}s`))
        .selectAll('text')
        .style('font-size', '10px')
        .attr('transform', 'rotate(-40)')
        .attr('text-anchor', 'end')
        .attr('dx', '-0.6em')
        .attr('dy', '0.15em');
    svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(6));

    const area = d3.area().x(p => x(p.decade)).y0(p => y(p.p25)).y1(p => y(p.p75));
    const medianLine = d3.line().x(p => x(p.decade)).y(p => y(p.median));
    const meanLine = d3.line().x(p => x(p.decade)).y(p => y(p.mean));

    series.forEach((s, si) => {
        const pts = s.points.filter(p => p.median != null);
        if(!pts.length) return;
        const bandColor = d3.color(s.color);
        bandColor.opacity = 0.18;
        if(pts.length > 1) svg.append('path').datum(pts).attr('d', area).attr('fill', bandColor.toString()).attr('stroke', 'none');
        svg.append('path').datum(pts).attr('d', meanLine).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3');
        svg.append('path').datum(pts).attr('d', medianLine).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2);
        // Classe par série : sans ça, le sélecteur générique 'circle' ré-utiliserait les cercles
        // d'une série précédente pour la suivante au lieu d'en créer de nouveaux (un seul jeu de
        // cercles aurait fini par s'afficher, écrasé série après série).
        svg.selectAll(`circle.pt-${si}`).data(pts).join('circle').attr('class', `pt-${si}`)
            .attr('cx', p => x(p.decade)).attr('cy', p => y(p.median)).attr('r', 3).attr('fill', s.color)
            .append('title').text(p => `${p.decade}s : médiane ${p.median.toFixed(1)} ans, moyenne ${p.mean.toFixed(1)} ans, 25e-75e percentile [${p.p25.toFixed(1)}–${p.p75.toFixed(1)}] (n=${p.n})`);
    });

    // Légende sur deux lignes : (1) une entrée par série (couleur = identité de la série),
    // (2) la signification des styles de trait (plein = médiane, pointillé = moyenne) et du
    // corridor ombré — communs à toutes les séries, donc en gris neutre, affichés une seule fois.
    const legendRow1 = svg.append('g').attr('transform', `translate(${margin.left}, 2)`);
    let gx1 = 0;
    series.forEach(s => {
        if(!s.points.some(p => p.median != null)) return;
        legendRow1.append('rect').attr('x', gx1).attr('y', 0).attr('width', 10).attr('height', 10).attr('fill', s.color);
        legendRow1.append('text').attr('x', gx1 + 14).attr('y', 9).style('font-size', '10px').text(s.name);
        gx1 += 14 + s.name.length * 5.5 + 16;
    });

    const legendRow2 = svg.append('g').attr('transform', `translate(${margin.left}, 18)`);
    let gx2 = 0;
    const addStyleEntry = (label, draw) => {
        draw(legendRow2, gx2);
        legendRow2.append('text').attr('x', gx2 + 20).attr('y', 9).style('font-size', '10px').text(label);
        gx2 += 20 + label.length * 5.5 + 12;
    };
    addStyleEntry('Médiane', (g, x0) => g.append('line').attr('x1', x0).attr('x2', x0 + 16).attr('y1', 5).attr('y2', 5).attr('stroke', '#555').attr('stroke-width', 2));
    addStyleEntry('Moyenne', (g, x0) => g.append('line').attr('x1', x0).attr('x2', x0 + 16).attr('y1', 5).attr('y2', 5).attr('stroke', '#555').attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3'));
    addStyleEntry('Corridor = 25e–75e percentile', (g, x0) => g.append('rect').attr('x', x0).attr('y', 0).attr('width', 14).attr('height', 10).attr('fill', '#888').attr('fill-opacity', 0.3));
}

export function drawAgeDeathTrend(list) {
    const container = d3.select('#ageChartDeathTrend');
    const byDecadeM = new Map(), byDecadeF = new Map();
    list.forEach(i => {
        if(i.death?.year && i.ageDeath != null && i.ageDeath >= 0 && i.ageDeath <= 110 && (i.sex === 'M' || i.sex === 'F')) {
            const dec = decadeOf(i.death.year);
            const target = i.sex === 'M' ? byDecadeM : byDecadeF;
            if(!target.has(dec)) target.set(dec, []);
            target.get(dec).push(i.ageDeath);
        }
    });
    const pointsM = Array.from(byDecadeM.keys()).sort((a, b) => a - b).map(dec => ({ decade: dec, ...computeStats(byDecadeM.get(dec)) }));
    const pointsF = Array.from(byDecadeF.keys()).sort((a, b) => a - b).map(dec => ({ decade: dec, ...computeStats(byDecadeF.get(dec)) }));
    drawMeanStdChart(container, [
        { name: 'Hommes', color: '#3498db', points: pointsM },
        { name: 'Femmes', color: '#e91e8c', points: pointsF }
    ], { emptyText: 'Pas assez de données (naissance, décès et sexe requis).' });
}

export function drawFirstChildTrend(list) {
    const container = d3.select('#ageChartFirstChildTrend');
    const byDecadeM = new Map(), byDecadeF = new Map();
    list.forEach(i => {
        if(i.birth?.year && i.ageFirstChild != null && (i.sex === 'M' || i.sex === 'F')) {
            const dec = decadeOf(i.birth.year);
            const target = i.sex === 'M' ? byDecadeM : byDecadeF;
            if(!target.has(dec)) target.set(dec, []);
            target.get(dec).push(i.ageFirstChild);
        }
    });
    const pointsM = Array.from(byDecadeM.keys()).sort((a, b) => a - b).map(dec => ({ decade: dec, ...computeStats(byDecadeM.get(dec)) }));
    const pointsF = Array.from(byDecadeF.keys()).sort((a, b) => a - b).map(dec => ({ decade: dec, ...computeStats(byDecadeF.get(dec)) }));
    drawMeanStdChart(container, [
        { name: 'Hommes', color: '#3498db', points: pointsM },
        { name: 'Femmes', color: '#e91e8c', points: pointsF }
    ], { emptyText: 'Pas assez de données (sexe et âge au 1er enfant requis).' });
}

// --- ÂGE AU DÉCÈS PAR PROFESSION (violon) ---
// Regroupe les "1 OCCU" par libellé normalisé (casse/espaces) et ne garde, pour chaque personne,
// que celles dont l'âge au décès est connu et plausible. minSample écarte les métiers trop rares
// pour qu'un violon soit lisible (Plotly affiche quand même les points bruts + une boîte à
// moustaches par-dessus, donc un seuil bas reste informatif même avec peu de monde) ; maxGroups
// limite l'encombrement visuel.
export function computeProfessionAgeGroups(list, minSample = 3, maxGroups = 8) {
    const byProfession = new Map();
    list.forEach(p => {
        if(p.ageDeath == null || p.ageDeath < 0 || p.ageDeath > 110) return;
        // Une même personne peut avoir plusieurs entrées pour le même métier (recensements successifs,
        // voir gedcom.js) : on déduplique par personne pour qu'elle ne pèse qu'une fois dans la
        // distribution d'âges de ce métier, quel que soit le nombre d'actes où il a été relevé.
        const distinctProfs = new Set((p.occupations || []).map(occ => (occ.profession || '').trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean));
        distinctProfs.forEach(key => {
            if(!byProfession.has(key)) byProfession.set(key, { label: key.charAt(0).toUpperCase() + key.slice(1), ages: [] });
            byProfession.get(key).ages.push(p.ageDeath);
        });
    });
    return Array.from(byProfession.values())
        .filter(g => g.ages.length >= minSample)
        .sort((a, b) => b.ages.length - a.ages.length)
        .slice(0, maxGroups);
}

// Violon (Plotly, pas D3 comme le reste du site) : une silhouette par profession montre d'un coup
// d'œil si un métier concentre les décès (pic étroit) ou les étale (silhouette large), ce qu'une
// simple moyenne masquerait. Plotly a été choisi ici — plutôt qu'un KDE D3 fait main — car son tracé
// violin gère nativement les petits échantillons (points bruts + boîte à moustaches superposés
// restent lisibles même quand la silhouette elle-même est peu significative).
export function drawProfessionAgeViolin(list) {
    const containerId = 'professionAgeViolinChart';
    const container = document.getElementById(containerId);
    if(!container) return;

    const groups = computeProfessionAgeGroups(list);
    if(!groups.length) {
        container.innerHTML = '<div class="map-placeholder">Pas assez de données (profession + âge au décès, au moins 3 personnes par métier) pour ce graphique.</div>';
        return;
    }
    if(typeof Plotly === 'undefined') {
        container.innerHTML = '<div class="map-placeholder" style="color:#c0392b">Bibliothèque Plotly non chargée.</div>';
        return;
    }

    // Plotly.newPlot ne vide pas le conteneur avant de dessiner : sans ce reset, le placeholder
    // statique ("Chargez un fichier GEDCOM...") de la page reste affiché sous le graphique.
    container.innerHTML = '';

    const x = [], y = [];
    groups.forEach(g => g.ages.forEach(age => { x.push(g.label); y.push(age); }));

    const trace = {
        type: 'violin',
        x, y,
        points: 'all',
        jitter: 0.35,
        pointpos: 0,
        marker: { size: 4, opacity: 0.5, color: '#2980b9' },
        line: { color: '#2980b9' },
        fillcolor: '#3498db',
        opacity: 0.6,
        box: { visible: true },
        meanline: { visible: true },
        hoveron: 'points+kde'
    };

    Plotly.newPlot(containerId, [trace], {
        yaxis: { title: 'Âge au décès', zeroline: false },
        xaxis: { categoryorder: 'array', categoryarray: groups.map(g => g.label) },
        margin: { t: 20, r: 20, b: 90, l: 55 },
        height: 400,
        font: { size: 11 }
    }, { displayModeBar: false, responsive: true });
}

// --- JOUR DE LA SEMAINE DU MARIAGE, PAR PÉRIODE DE 20 ANS ---
// Nécessite une date de mariage complète et certaine (jour, mois, année) — voir
// GedcomParser.getWeekday() — donc généralement une fraction seulement des mariages du fichier.
// Une série par jour (lundi...dimanche), en nombre de mariages (pas une moyenne) par période de 20
// ans : plus direct à lire qu'un unique indicateur moyenne±écart-type sur l'échelle 1-7.
const WEEKDAY_COLORS = ['#3498db', '#e67e22', '#2ecc71', '#9b59b6', '#e74c3c', '#1abc9c', '#7f8c8d'];
const MARRIAGE_WEEKDAY_PERIOD = 20;

export function drawMarriageWeekdayTrend(fams) {
    const container = d3.select('#marriageWeekdayChart');
    container.selectAll('*').remove();

    // counts[jour 0=lundi...6=dimanche] = Map(période -> nombre de mariages)
    const counts = Array.from({ length: 7 }, () => new Map());
    let any = false;

    fams.forEach(f => {
        if(f.marr?.year == null || f.marr?.weekday == null) return;
        const iso = f.marr.weekday === 0 ? 7 : f.marr.weekday; // 0=dimanche (JS) -> 7 (convention FR)
        const dayIndex = iso - 1;
        const period = periodOf(f.marr.year, MARRIAGE_WEEKDAY_PERIOD);
        counts[dayIndex].set(period, (counts[dayIndex].get(period) || 0) + 1);
        any = true;
    });

    if(!any) {
        container.append('div').attr('class', 'map-placeholder').text('Pas assez de données (date de mariage complète — jour, mois, année — requise).');
        return;
    }

    const allPeriods = Array.from(new Set(counts.flatMap(m => Array.from(m.keys())))).sort((a, b) => a - b);

    const width = container.node().clientWidth || 600, height = 330;
    const margin = { top: 40, right: 20, bottom: 58, left: 45 };
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const x = d3.scalePoint().domain(allPeriods).range([margin.left, width - margin.right]).padding(0.5);
    const maxCount = d3.max(counts, m => d3.max(Array.from(m.values()))) || 1;
    const y = d3.scaleLinear().domain([0, maxCount]).nice().range([height - margin.bottom, margin.top]);

    const maxLabels = Math.max(4, Math.floor((width - margin.left - margin.right) / 45));
    const labelStep = Math.max(1, Math.ceil(allPeriods.length / maxLabels));
    const tickValues = allPeriods.filter((d, i) => i % labelStep === 0);

    svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickValues(tickValues).tickFormat(d => `${d}-${d + MARRIAGE_WEEKDAY_PERIOD - 1}`))
        .selectAll('text').style('font-size', '9px').attr('transform', 'rotate(-40)').attr('text-anchor', 'end');
    svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('d')));
    svg.append('text').attr('x', margin.left).attr('y', 10).style('font-size', '10px').style('fill', '#7f8c8d').text('Nombre de mariages');

    const line = d3.line().x(d => x(d[0])).y(d => y(d[1]));
    const tooltip = document.getElementById('tooltip');

    WEEKDAY_LABELS.forEach((label, dayIndex) => {
        const dayCounts = counts[dayIndex];
        if(!dayCounts.size) return;
        const points = allPeriods.filter(p => dayCounts.has(p)).map(p => [p, dayCounts.get(p)]);
        const color = WEEKDAY_COLORS[dayIndex];

        if(points.length > 1) {
            svg.append('path').datum(points).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2);
        }
        svg.selectAll(`circle.wd-${dayIndex}`).data(points).join('circle').attr('class', `wd-${dayIndex}`)
            .attr('cx', d => x(d[0])).attr('cy', d => y(d[1])).attr('r', 3).attr('fill', color)
            .on('mouseover', (e, d) => {
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${label}</strong><div class="tt-row"><span>${d[0]}-${d[0] + MARRIAGE_WEEKDAY_PERIOD - 1}</span><span>${d[1]} mariage${d[1] > 1 ? 's' : ''}</span></div>`;
            })
            .on('mousemove', e => {
                tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
                tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
            })
            .on('mouseout', () => { tooltip.style.opacity = 0; });
    });

    const legend = svg.append('g').attr('transform', `translate(${margin.left}, 20)`);
    let gx = 0;
    WEEKDAY_LABELS.forEach((label, i) => {
        legend.append('rect').attr('x', gx).attr('y', 0).attr('width', 10).attr('height', 10).attr('fill', WEEKDAY_COLORS[i]);
        legend.append('text').attr('x', gx + 14).attr('y', 9).style('font-size', '9px').text(label);
        gx += 14 + label.length * 5 + 12;
    });
}

// --- PRÉNOMS LES PLUS FRÉQUENTS PAR SIÈCLE (H/F) ---
// Même convention que getPyramidDecades ci-dessus (liste des siècles couverts par des naissances
// datées), utilisée pour calibrer le curseur "période" de visualisation.html.
export function getNameCenturies(list) {
    const years = list.map(i => i.birth?.year).filter(Boolean);
    if(!years.length) return [];
    const minC = centuryOf(d3.min(years)), maxC = centuryOf(d3.max(years));
    const centuries = [];
    for(let c = minC; c <= maxC; c++) centuries.push(c);
    return centuries;
}

function firstGivenName(p) {
    const g = p.given || (p.name || '').split(' ')[0];
    return g ? g.trim().split(' ')[0] : null;
}

// centuryMin/centuryMax = null : pas de borne de ce côté (toutes périodes si les deux sont null).
export function computeTopNames(list, sex, centuryMin, centuryMax, limit = 10) {
    const counts = new Map();
    list.forEach(p => {
        if(p.sex !== sex) return;
        if(centuryMin != null || centuryMax != null) {
            const c = p.birth?.year != null ? centuryOf(p.birth.year) : null;
            if(c == null) return;
            if(centuryMin != null && c < centuryMin) return;
            if(centuryMax != null && c > centuryMax) return;
        }
        const raw = firstGivenName(p);
        if(!raw) return;
        const key = raw.toLowerCase();
        if(!counts.has(key)) counts.set(key, { label: raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase(), count: 0 });
        counts.get(key).count++;
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

function drawHorizontalBarChart(containerId, data, opts = {}) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();
    if(!data.length) {
        container.append('div').attr('class', 'map-placeholder').text(opts.emptyMessage || 'Aucune donnée disponible.');
        return;
    }

    const width = container.node().clientWidth || 380;
    const barHeight = 22;
    const margin = { top: 8, right: 36, bottom: 8, left: 90 };
    const height = margin.top + margin.bottom + data.length * barHeight;
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const maxCount = d3.max(data, d => d.count) || 1;
    const x = d3.scaleLinear().domain([0, maxCount]).nice().range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(data.map(d => d.label)).range([margin.top, height - margin.bottom]).padding(0.22);
    const color = opts.color || '#3498db';

    svg.selectAll('rect.bar').data(data).join('rect').attr('class', 'bar')
        .attr('x', x(0)).attr('y', d => y(d.label)).attr('width', d => x(d.count) - x(0)).attr('height', y.bandwidth())
        .attr('fill', color);
    svg.selectAll('text.bar-label').data(data).join('text').attr('class', 'bar-label')
        .attr('x', margin.left - 8).attr('y', d => y(d.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .attr('text-anchor', 'end').style('font-size', '11px').text(d => d.label);
    svg.selectAll('text.bar-count').data(data).join('text').attr('class', 'bar-count')
        .attr('x', d => x(d.count) + 5).attr('y', d => y(d.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .style('font-size', '10px').style('fill', '#555').text(d => d.count);
}

export function drawTopNamesForCentury(list, centuryMin, centuryMax) {
    drawHorizontalBarChart('namesMaleChart', computeTopNames(list, 'M', centuryMin, centuryMax), { color: '#3498db', emptyMessage: 'Pas de prénom masculin daté pour cette période.' });
    drawHorizontalBarChart('namesFemaleChart', computeTopNames(list, 'F', centuryMin, centuryMax), { color: '#e91e8c', emptyMessage: 'Pas de prénom féminin daté pour cette période.' });
}
