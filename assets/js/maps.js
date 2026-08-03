import { GEO } from './geo.js';
import { escapeHtml, computeStats, decadeOf } from './utils.js';

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

// Pays limitrophes/proches affichés en gris clair autour de la France sur la carte des
// départements, pour donner un contexte géographique (pas de coloration par données).
let europeGeoCache = null;
export async function ensureEuropeGeo() {
    if(!europeGeoCache) {
        // Natural Earth admin-0 (résolution 110m) : fichier léger, suffisant pour de simples
        // contours de pays voisins (on n'a pas besoin du détail utilisé pour les départements).
        const res = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
        europeGeoCache = await res.json();
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

const GEO_EVENT_LABELS = { BIRT: 'Naissance', DEAT: 'Décès', MARR: 'Mariage' };

// Compte les lieux (pays / département) par type d'événement activé, pour un ensemble d'individus
// donné. opts.yearMax, si fourni, restreint aux événements datés et survenus au plus tard cette
// année-là (permet de rejouer l'évolution des lieux au fil du temps) ; sans cutoff, les événements
// sans date connue restent inclus comme avant.
export function computeGeoCounts(scopeIds, individuals, eventFlags, opts) {
    const yearMax = opts && opts.yearMax != null ? opts.yearMax : null;
    const byCountry = {}, byDept = {};
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
        // Priorité aux coordonnées GPS exactes du GEDCOM (LATI/LONG), sinon préfecture du
        // département, sinon centroïde du pays.
        if(geo.lat != null && geo.lon != null) {
            addPoint('gps:' + geo.lat.toFixed(3) + ',' + geo.lon.toFixed(3), geo.dept || geo.raw || geo.country, [geo.lon, geo.lat], item);
            return;
        }
        if(geo.dept) {
            const code = geo.dept.split(' - ')[0];
            if(GEO.deptCentroids[code]) { addPoint('dept:' + code, geo.dept, GEO.deptCentroids[code], item); return; }
        }
        if(geo.country && geo.country !== 'Inconnu') addPoint('country:' + geo.country, geo.country, GEO.countryCentroids[geo.country], item);
    };
    // Avec un cutoff temporel actif, seuls les événements datés (et antérieurs ou égaux au cutoff)
    // comptent — un événement sans date ne peut pas être situé dans le temps, donc il n'apparaît
    // que lorsque le filtre temporel est désactivé (comportement identique au slider par décennie
    // de la pyramide des âges, cf. drawAgePyramidForSelectedDecade).
    const passesTime = year => yearMax == null || (year != null && year <= yearMax);
    scopeIds.forEach(id => {
        const i = individuals.get(id);
        if(!i) return;
        if(eventFlags.BIRT && passesTime(i.birth?.year)) add(i.birth?.geo, { name: i.name, type: 'BIRT', typeLabel: GEO_EVENT_LABELS.BIRT, year: i.birth?.year || null });
        if(eventFlags.DEAT && passesTime(i.death?.year)) add(i.death?.geo, { name: i.name, type: 'DEAT', typeLabel: GEO_EVENT_LABELS.DEAT, year: i.death?.year || null });
        if(eventFlags.MARR && passesTime(i.marrYear)) add(i.marrGeo, { name: i.name, type: 'MARR', typeLabel: GEO_EVENT_LABELS.MARR, year: i.marrYear || null });
    });
    return { byCountry, byDept, byWorldPoint };
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
        if(i.death?.year && i.ageDeath != null && (i.sex === 'M' || i.sex === 'F')) {
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

// Regroupe les "1 OCCU" (métier/profession) sur l'ensemble des individus, en normalisant la casse
// et les espaces pour le regroupement (ex. "Cultivateur" et "cultivateur" comptent ensemble) tout
// en affichant un libellé propre. Une personne avec plusieurs métiers compte dans chacun d'eux.
export function computeOccupationCounts(list, limit) {
    const counts = new Map();
    list.forEach(p => {
        (p.occupations || []).forEach(raw => {
            const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
            if(!key) return;
            counts.set(key, (counts.get(key) || 0) + 1);
        });
    });
    const arr = Array.from(counts.entries())
        .map(([key, count]) => ({ label: key.charAt(0).toUpperCase() + key.slice(1), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return limit ? arr.slice(0, limit) : arr;
}

// Diagramme en barres horizontales des professions (tag GEDCOM OCCU) les plus fréquentes.
// Horizontal plutôt que vertical : les libellés de métier sont du texte libre, souvent trop long
// pour tenir sous des barres verticales sans se chevaucher.
export function drawOccupationsChart(list) {
    const container = d3.select('#occupationsChart');
    container.selectAll('*').remove();
    const data = computeOccupationCounts(list, 15);
    if(!data.length) {
        container.append('div').attr('class', 'map-placeholder').text('Aucune profession (tag OCCU) trouvée dans ce fichier.');
        return;
    }

    const width = container.node().clientWidth || 500;
    const barHeight = 22;
    const margin = { top: 10, right: 44, bottom: 10, left: 150 };
    const height = margin.top + margin.bottom + data.length * barHeight;
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const maxCount = d3.max(data, d => d.count) || 1;
    const x = d3.scaleLinear().domain([0, maxCount]).nice().range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(data.map(d => d.label)).range([margin.top, height - margin.bottom]).padding(0.22);

    const tooltip = document.getElementById('tooltip');
    svg.selectAll('rect.bar').data(data).join('rect')
        .attr('class', 'bar')
        .attr('x', x(0)).attr('y', d => y(d.label)).attr('width', d => x(d.count) - x(0)).attr('height', y.bandwidth())
        .attr('fill', '#3498db')
        .on('mouseover', function(e, d) {
            d3.select(this).attr('fill', '#2980b9');
            tooltip.style.opacity = 1;
            tooltip.innerHTML = `<strong>${escapeHtml(d.label)}</strong><div class="tt-row"><span>Occurrences</span><span>${d.count}</span></div>`;
        })
        .on('mousemove', e => {
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('fill', '#3498db');
            tooltip.style.opacity = 0;
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
