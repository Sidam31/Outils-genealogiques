// --- FRISE DE VIE : rendu D3 (axe chronologique + événements en cascade + contexte historique) ---
import { buildLifeEvents, computeWaterfallLayout, getHistoricalWindow, packHistoricalLanes, estimateTextWidth } from './timeline.js';
import { FRENCH_HISTORICAL_TIMELINE } from './historical-timeline.js';
import { escapeHtml } from './utils.js';

const CATEGORY_LABELS = { monarque: 'Monarque', regime: 'Régime', president: 'Président', evenement: 'Événement historique' };
const MARGIN = { top: 64, right: 30, bottom: 30, left: 30 };
const PX_PER_YEAR = 22;
const LANE_HEIGHT = 22;
const AXIS_GAP = 22; // espace entre l'axe et la première voie de contexte historique
const GOLDEN_ANGLE = 137.508; // écart angulaire (degrés) maximisant la distinction perceptuelle entre teintes successives

// Lieu le plus précis disponible pour un événement : commune si géolocalisée, sinon repli sur
// département/région/pays (mêmes champs qu'analyzePlace dans gedcom.js).
function placeLabel(geo) {
    if (!geo) return null;
    return geo.city || geo.dept || geo.region || geo.country || null;
}

// Clé de regroupement "couleur par lieu" pour les marqueurs d'événements : le département quand il
// est connu (le plus utile pour repérer les déplacements d'une personne en France), sinon le pays
// (utile pour distinguer les événements à l'étranger). Les deux personnes du même département
// obtiennent donc toujours la même couleur, cohérent d'un événement à l'autre sur une même frise.
function placeColorKey(geo) {
    if (!geo) return null;
    return geo.dept || geo.country || null;
}

// Attribue à chaque lieu rencontré (au fil des événements, dans l'ordre chronologique) une teinte
// HSL distincte via l'angle d'or : contrairement à une palette fixe (limitée en nombre d'entrées,
// ou nécessitant de couvrir à l'avance les ~100 départements français), cette méthode reste
// cohérente et lisible quel que soit le nombre de lieux réellement présents sur CETTE frise.
class PlaceColorAssigner {
    constructor(defaultColor) {
        this.defaultColor = defaultColor;
        this.map = new Map(); // clé lieu -> couleur
        this.legend = []; // [{ key, label, color }], dans l'ordre de première apparition
    }
    colorFor(geo) {
        const key = placeColorKey(geo);
        if (!key) return this.defaultColor;
        if (!this.map.has(key)) {
            const hue = (this.map.size * GOLDEN_ANGLE) % 360;
            const color = `hsl(${hue.toFixed(1)}, 62%, 45%)`;
            this.map.set(key, color);
            this.legend.push({ key, label: key, color });
        }
        return this.map.get(key);
    }
}

// Les couleurs du graphique sont posées via var(--frise-*) dans app.css pour rester cohérentes avec
// le reste de l'appli — mais le bouton "copier l'image" (copySvgAsPng, utils.js) clone le <svg> et le
// sérialise HORS du document (Image() sur un blob autonome) pour le dessiner sur un <canvas> : ce
// clone n'a plus accès à la feuille de style externe où ces variables sont définies, donc var(...) ne
// s'y résout plus (couleurs manquantes/noires sur l'image copiée). On résout donc une fois par rendu
// les valeurs réelles depuis le document (où le cascade fonctionne normalement) et on les pose comme
// couleurs littérales sur les éléments SVG, qui restent alors correctes qu'elles soient affichées en
// direct ou copiées/sérialisées à part.
function resolveColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    return {
        axis: get('--frise-axis', '#2c3e50'),
        stem: get('--frise-stem', '#b8c4d9'),
        marker: get('--frise-marker', '#3b82f6'),
        border: get('--border', '#ddd'),
        text: get('--text', '#333'),
        accent: get('--accent', '#2c3e50'),
        lane: {
            monarque: get('--frise-lane-monarque', '#8e6b46'),
            regime: get('--frise-lane-regime', '#c0392b'),
            president: get('--frise-lane-president', '#2c7fb8'),
            evenement: get('--frise-lane-evenement', '#7f8c8d'),
        }
    };
}

export class FriseChart {
    // onEmpty(person) est appelé quand la personne sélectionnée n'a aucun événement daté (rien à tracer).
    constructor(id, { onEmpty, onReady } = {}) {
        this.div = document.getElementById(id);
        this.tooltip = document.getElementById('tooltip');
        this.showHistory = true;
        this.onEmpty = onEmpty;
        this.onReady = onReady;
        this.person = null; this.map = null; this.fams = null;
        this.init();
        window.addEventListener('resize', () => { if (this.person) this.render(); });
    }

    init() {
        this.div.innerHTML = '';
        this.svg = d3.select(this.div).append('svg');
    }

    setShowHistory(show) { this.showHistory = show; if (this.person) this.render(); }

    setData(person, map, fams) {
        this.person = person; this.map = map; this.fams = fams;
        this.render();
    }

    render() {
        this.svg.selectAll('*').remove();
        const colors = resolveColors();
        const life = buildLifeEvents(this.person, this.map, this.fams);

        if (!life.events.length) {
            this.svg.attr('width', 0).attr('height', 0);
            if (this.onEmpty) this.onEmpty(this.person, life);
            return;
        }

        const laidOut = computeWaterfallLayout(life.events);
        const maxStem = Math.max(...laidOut.map(e => e.stemHeight));

        const years = life.events.map(e => e.year);
        const minYear = Math.min(...years) - 1;
        const maxYear = Math.max(...years) + 1;

        let historical = { items: [], laneCount: 0 };
        const historyWindow = this.showHistory ? getHistoricalWindow(FRENCH_HISTORICAL_TIMELINE, life.birthYear, life.deathYear) : [];

        const containerWidth = this.div.clientWidth || 900;
        const yearSpan = Math.max(1, maxYear - minYear);
        const width = Math.max(containerWidth, MARGIN.left + MARGIN.right + yearSpan * PX_PER_YEAR);

        const xScale = d3.scaleLinear().domain([minYear, maxYear]).range([MARGIN.left, width - MARGIN.right]);

        if (this.showHistory && historyWindow.length) {
            historical = packHistoricalLanes(historyWindow, xScale);
        }

        const axisY = MARGIN.top + maxStem + 18;
        const historyHeight = historical.laneCount ? AXIS_GAP + historical.laneCount * LANE_HEIGHT : 0;
        const height = axisY + 22 + historyHeight + MARGIN.bottom;

        this.svg.attr('width', width).attr('height', height);

        // Nom de la personne, bien visible en haut de la frise (fait aussi partie de l'image copiée,
        // contrairement à un titre posé en HTML au-dessus du graphique).
        const lifespan = (life.birthYear != null || life.deathYear != null)
            ? `${life.birthYear != null ? life.birthYear : '?'} – ${life.deathYear != null ? life.deathYear : '…'}`
            : '';
        // NB: .style() (et non .attr()) pour font-size/fill/font-weight ci-dessous et plus bas dans
        // ce fichier — une règle CSS globale non scopée ("text { font-size:7px; ... }", app.css,
        // écrite pour l'Arbre éventail) cible tout élément <text> de l'appli ; un attribut de
        // présentation SVG (.attr) a la priorité la PLUS BASSE de toute la cascade CSS, donc perdait
        // silencieusement face à cette règle. Un style inline (.style) l'emporte toujours, quelle que
        // soit la spécificité de la règle en face.
        this.svg.append('text')
            .attr('x', MARGIN.left).attr('y', 26)
            .style('font-size', '24px').style('font-weight', '800').style('fill', colors.accent)
            .text(life.personName || 'Inconnu');
        if (lifespan) {
            this.svg.append('text')
                .attr('x', MARGIN.left).attr('y', 46)
                .style('font-size', '13px').style('fill', '#777')
                .text(lifespan);
        }

        // Repères annuels (traits verticaux légers + graduation en bas de l'axe), calés sur les mêmes
        // décennies affichées en étiquette pour rester lisible sur de longues plages de vie.
        const gridlines = this.svg.append('g').attr('class', 'frise-gridlines');
        xScale.ticks(Math.max(2, Math.round(width / 90))).forEach(yr => {
            const x = xScale(yr);
            gridlines.append('line')
                .attr('x1', x).attr('x2', x).attr('y1', MARGIN.top - 4).attr('y2', axisY + 6)
                .attr('stroke', colors.border).attr('stroke-dasharray', '2,3');
            gridlines.append('text')
                .attr('x', x).attr('y', axisY + 20).attr('text-anchor', 'middle')
                .style('font-size', '10px').style('fill', '#888')
                .text(Math.round(yr));
        });

        // Axe principal
        this.svg.append('line')
            .attr('x1', xScale(minYear)).attr('x2', xScale(maxYear))
            .attr('y1', axisY).attr('y2', axisY)
            .attr('stroke', colors.axis).attr('stroke-width', 3).attr('stroke-linecap', 'round');

        // Événements : tige + marqueur + libellé, en cascade (le plus ancien = tige la plus haute).
        // Les marqueurs sont colorés par lieu (département, à défaut pays) pour repérer d'un coup
        // d'œil les déplacements de la personne ; les événements sans lieu connu gardent la couleur
        // par défaut de l'application.
        const placeColors = new PlaceColorAssigner(colors.marker);
        const evG = this.svg.append('g').attr('class', 'frise-events');
        laidOut.forEach(e => {
            const x = xScale(e.year);
            const labelY = axisY - e.stemHeight - 6;
            const place = placeLabel(e.geo);
            const ageText = e.age != null ? ` (${e.ageEstimated ? '~' : ''}${e.age} ans)` : '';
            const text = `${e.label} : ${e.year}${e.approx ? ' (env.)' : ''}${ageText}${place ? ` — ${place}` : ''}`;
            const flip = (x + estimateTextWidth(text)) > (width - MARGIN.right);
            const dotColor = placeColors.colorFor(e.geo);

            evG.append('line')
                .attr('x1', x).attr('x2', x).attr('y1', axisY).attr('y2', axisY - e.stemHeight)
                .attr('stroke', colors.stem).attr('stroke-width', 1.5);

            const label = evG.append('text')
                .attr('x', flip ? x - 6 : x + 6).attr('y', labelY)
                .attr('text-anchor', flip ? 'end' : 'start')
                .style('font-size', '11px').style('fill', colors.text).style('pointer-events', 'auto')
                .text(text);

            const dot = evG.append('circle')
                .attr('cx', x).attr('cy', axisY).attr('r', 4)
                .attr('fill', dotColor).attr('stroke', '#fff').attr('stroke-width', 1.5)
                .style('cursor', 'pointer');

            const showTip = ev => {
                const t = this.tooltip;
                if (!t) return;
                t.style.opacity = 1;
                t.innerHTML = `<strong>${escapeHtml(e.label)}</strong>
                    <div class="tt-row"><span class="tt-lbl">Année</span><span>${e.year}${e.approx ? ' (environ)' : ''}</span></div>
                    ${e.age != null ? `<div class="tt-row"><span class="tt-lbl">Âge</span><span>${e.age} ans${e.ageEstimated ? ' (estimé)' : ''}</span></div>` : ''}
                    ${place ? `<div class="tt-row"><span class="tt-lbl">Lieu</span><span>${escapeHtml(place)}</span></div>` : ''}
                    ${e.raw ? `<div class="tt-raw">"${escapeHtml(e.raw)}"</div>` : ''}`;
                t.style.left = Math.min(ev.pageX + 15, window.innerWidth - 320) + 'px';
                t.style.top = Math.min(ev.pageY + 15, window.innerHeight - 250) + 'px';
            };
            dot.on('mouseenter', showTip).on('mousemove', showTip)
               .on('mouseleave', () => { if (this.tooltip) this.tooltip.style.opacity = 0; });
            label.on('mouseenter', showTip).on('mousemove', showTip)
                 .on('mouseleave', () => { if (this.tooltip) this.tooltip.style.opacity = 0; });
        });

        // Contexte historique : voies empilées sous l'axe (régimes/chefs d'État qui recouvrent la vie
        // de la personne), avec la même échelle x que la frise pour que les décennies s'alignent.
        if (historical.laneCount) {
            const histG = this.svg.append('g').attr('class', 'frise-history');
            const startY = axisY + AXIS_GAP;
            historical.items.forEach(item => {
                const y = startY + item.lane * LANE_HEIGHT;
                const barW = Math.max(2, item.x2 - item.x1);
                histG.append('rect')
                    .attr('x', item.x1).attr('y', y).attr('width', barW).attr('height', 12).attr('rx', 2)
                    .attr('fill', colors.lane[item.category] || colors.lane.evenement).attr('opacity', 0.85)
                    .append('title').text(`${item.label} — ${CATEGORY_LABELS[item.category] || ''} (${item.start}–${item.end})`);
                const labelW = estimateTextWidth(item.label, 10);
                const fitsInBar = labelW <= barW - 6;
                histG.append('text')
                    .attr('x', fitsInBar ? item.x1 + barW / 2 : item.x1 + barW + 4)
                    .attr('y', y + 9.5)
                    .attr('text-anchor', fitsInBar ? 'middle' : 'start')
                    // Libellé posé SUR le bandeau coloré (fond souvent sombre : rouge/bleu/brun) : texte
                    // blanc plutôt que le gris foncé utilisé quand il déborde sur le fond blanc du
                    // graphique — sinon illisible aussi bien à l'écran que sur l'image copiée.
                    .style('font-size', '10px').style('font-weight', fitsInBar ? '600' : 'normal')
                    .style('fill', fitsInBar ? '#fff' : '#555')
                    .text(item.label);
            });
        }

        if (this.onReady) this.onReady(this.person, life, placeColors.legend);
    }
}
