// --- RÉSEAU DE RELATIONS (graphe de personnes, 2D/3D) ---
// Chaque nœud est une personne, chaque lien une relation entre deux personnes : filiation, union,
// fratrie, association GEDCOM (parrain, témoin...) ou présence au même lieu la même année
// (recensement/résidence). Le rendu s'appuie sur force-graph (2D) et 3d-force-graph (3D), chargés
// en <script> UMD par reseau.html (globals ForceGraph / ForceGraph3D), et l'analyse des
// communautés sur graphology + graphology-library (globals graphology / graphologyLibrary).
// Les fonctions d'analyse (construction, BFS, chemin) n'utilisent pas le DOM.
import { escapeHtml } from './utils.js';

export const LINK_TYPES = {
    parent:      { label: 'Parent / enfant',            color: '#4f7fb0', defaultOn: true },
    conjoint:    { label: 'Conjoints',                  color: '#d0507a', defaultOn: true },
    fratrie:     { label: 'Frères et sœurs',            color: '#d99a2b', defaultOn: false },
    association: { label: 'Associations (parrain, témoin...)', color: '#2e9d6f', defaultOn: true },
    coresidence: { label: 'Même lieu, même année',      color: '#8e6cc0', defaultOn: false },
};

// Palette catégorielle des communautés (la dernière couleur sert aux petites communautés groupées).
const COMMUNITY_COLORS = ['#205a80', '#c0504d', '#43858b', '#d99a2b', '#7b5ea7', '#5a9b3e', '#c2668f', '#8c6d46', '#3f8fd1', '#b5a02c', '#5b6f7c', '#e07b39'];
const COMMUNITY_OTHER = '#9aa9b1';
const SEX_COLORS = { M: '#4f8fe0', F: '#e05f8f' };
const SEX_OTHER = '#9aa9b1';
// Au-delà, un même lieu/année (ex: tout un village recensé) formerait une clique illisible.
const CORESIDENCE_MAX_BUCKET = 15;

const idOf = end => (end && typeof end === 'object') ? end.id : end;

// Construit le graphe complet à partir des données de bootstrap(). Les liens sont dédoublonnés par
// paire (non orientée) et par type ; un lien "parent" est orienté parent -> enfant.
export function buildRelationGraph(list, map, fams) {
    const nodes = list.map(p => ({
        id: p.id, name: p.name || '?', sex: p.sex,
        birthYear: p.birth?.year || null, deathYear: p.death?.year || null,
        degree: 0, community: 0,
    }));
    const links = [];
    const seen = new Set();
    const add = (source, target, type, label, year = null) => {
        if(!source || !target || source === target || !map.has(source) || !map.has(target)) return;
        const key = type + '|' + (source < target ? source + '|' + target : target + '|' + source);
        if(seen.has(key)) return;
        seen.add(key);
        links.push({ source, target, type, label, year });
    };

    list.forEach(p => {
        add(p.fatherId, p.id, 'parent', 'Père');
        add(p.motherId, p.id, 'parent', 'Mère');
        (p.associations || []).forEach(a => add(p.id, a.indiId, 'association', a.rela || a.role || 'Association'));
    });
    fams.forEach(f => {
        add(f.husb, f.wife, 'conjoint', 'Union', f.marr?.year || null);
        const kids = (f.children || []).filter(c => map.has(c));
        for(let a = 0; a < kids.length; a++)
            for(let b = a + 1; b < kids.length; b++) add(kids[a], kids[b], 'fratrie', 'Fratrie');
    });

    // Même lieu (libellé brut) la même année, dans les recensements et résidences.
    const buckets = new Map();
    list.forEach(p => {
        [...(p.censusEvents || []), ...(p.resiEvents || [])].forEach(e => {
            const place = e.geo?.raw;
            if(!place || !e.year) return;
            const key = place + '|' + e.year;
            if(!buckets.has(key)) buckets.set(key, { place, year: e.year, ids: new Set() });
            buckets.get(key).ids.add(p.id);
        });
    });
    buckets.forEach(b => {
        const ids = [...b.ids];
        if(ids.length < 2 || ids.length > CORESIDENCE_MAX_BUCKET) return;
        for(let a = 0; a < ids.length; a++)
            for(let c = a + 1; c < ids.length; c++) add(ids[a], ids[c], 'coresidence', `${b.place}`, b.year);
    });

    return { nodes, links };
}

// Liste d'adjacence (non orientée) : id -> [{ other, link }].
export function buildAdjacency(graph) {
    const adj = new Map(graph.nodes.map(n => [n.id, []]));
    graph.links.forEach(l => {
        const s = idOf(l.source), t = idOf(l.target);
        adj.get(s)?.push({ other: t, link: l });
        adj.get(t)?.push({ other: s, link: l });
    });
    return adj;
}

// Degré de chaque nœud en ne comptant que les types de liens actifs.
export function computeDegrees(graph, adj, activeTypes) {
    graph.nodes.forEach(n => {
        n.degree = (adj.get(n.id) || []).filter(e => activeTypes.has(e.link.type)).length;
    });
}

// Communautés (Louvain) sur le graphe complet restreint aux types actifs. Les 11 plus grandes
// communautés ont une couleur propre, les autres partagent COMMUNITY_OTHER.
export function computeCommunities(graph, activeTypes) {
    const G = window.graphology, L = window.graphologyLibrary;
    if(!G || !L) { graph.nodes.forEach(n => { n.community = 0; n.communityColor = COMMUNITY_OTHER; }); return 0; }
    const g = new G.UndirectedGraph();
    graph.nodes.forEach(n => g.addNode(n.id));
    graph.links.forEach(l => {
        if(!activeTypes.has(l.type)) return;
        const s = idOf(l.source), t = idOf(l.target);
        if(!g.hasEdge(s, t)) g.addEdge(s, t);
    });
    const parts = g.size ? L.communitiesLouvain(g) : {};
    const sizes = new Map();
    graph.nodes.forEach(n => {
        n.community = parts[n.id] ?? -1;
        sizes.set(n.community, (sizes.get(n.community) || 0) + 1);
    });
    const ranked = [...sizes.entries()].filter(([c, s]) => s > 2).sort((a, b) => b[1] - a[1]);
    const colorOf = new Map(ranked.slice(0, COMMUNITY_COLORS.length - 1).map(([c], i) => [c, COMMUNITY_COLORS[i]]));
    graph.nodes.forEach(n => { n.communityColor = colorOf.get(n.community) || COMMUNITY_OTHER; });
    return ranked.length;
}

// Ensemble des personnes à au plus `hops` liens (types actifs) de centerId.
export function egoSubgraph(adj, centerId, hops, activeTypes) {
    const dist = new Map([[centerId, 0]]);
    let frontier = [centerId];
    for(let d = 1; d <= hops && frontier.length; d++) {
        const next = [];
        frontier.forEach(id => (adj.get(id) || []).forEach(({ other, link }) => {
            if(!activeTypes.has(link.type) || dist.has(other)) return;
            dist.set(other, d);
            next.push(other);
        }));
        frontier = next;
    }
    return dist;
}

// Plus court chemin (nombre de liens) entre deux personnes : [{ id, link }] où link relie la
// personne précédente à celle-ci (null pour la première), ou null si aucun chemin.
export function shortestPath(adj, fromId, toId, activeTypes) {
    if(!adj.has(fromId) || !adj.has(toId)) return null;
    const prev = new Map([[fromId, null]]);
    const queue = [fromId];
    for(let k = 0; k < queue.length && !prev.has(toId); k++) {
        const id = queue[k];
        (adj.get(id) || []).forEach(({ other, link }) => {
            if(!activeTypes.has(link.type) || prev.has(other)) return;
            prev.set(other, { from: id, link });
            queue.push(other);
        });
    }
    if(!prev.has(toId)) return null;
    const steps = [];
    for(let id = toId; id !== fromId; id = prev.get(id).from) steps.unshift({ id, link: prev.get(id).link });
    steps.unshift({ id: fromId, link: null });
    return steps;
}

// Ce qu'est `toPerson` pour `fromPerson` à travers `link` (ex: "père", "épouse", "parrain").
export function describeStep(link, fromId, toPerson) {
    const f = toPerson?.sex === 'F', m = toPerson?.sex === 'M';
    const pick = (male, female, other) => m ? male : f ? female : other;
    switch(link.type) {
        case 'parent':
            return idOf(link.source) === toPerson.id ? pick('père', 'mère', 'parent') : pick('fils', 'fille', 'enfant');
        case 'conjoint': return pick('époux', 'épouse', 'conjoint');
        case 'fratrie': return pick('frère', 'sœur', 'frère/sœur');
        case 'association': {
            const rela = link.label || 'association';
            return idOf(link.source) === fromId ? `associé (${rela})` : `${rela} (association inverse)`;
        }
        case 'coresidence': return `même lieu en ${link.year} (${link.label})`;
        default: return 'lié à';
    }
}

// --- RENDU ---
const FADED_NODE = 'rgba(160,172,180,0.25)';
const FADED_LINK = 'rgba(160,172,180,0.10)';
const PATH_COLOR = '#f2b01e';

export class ReseauChart {
    constructor(containerId, { onNodeClick } = {}) {
        this.el = document.getElementById(containerId);
        this.onNodeClick = onNodeClick;
        this.mode = '2d';
        this.colorBy = 'community';
        this.graph = null;
        this.centerId = null;
        this.pathIds = new Set();
        this.pathLinks = new Set();
        this.hoverIds = new Set();
        this.hoverLinks = new Set();
        this.shownNodes = new Map();
        this.data = { nodes: [], links: [] };
        this.fg = null;
        new ResizeObserver(() => this._fitSize()).observe(this.el);
    }

    _fitSize() {
        if(this.fg) this.fg.width(this.el.clientWidth).height(this.el.clientHeight);
    }

    _create() {
        if(this.fg) { this.fg._destructor?.(); this.el.innerHTML = ''; }
        const is3d = this.mode === '3d';
        this.fg = is3d
            ? window.ForceGraph3D({ rendererConfig: { antialias: true, alpha: false, preserveDrawingBuffer: true } })(this.el)
            : window.ForceGraph()(this.el);
        const fg = this.fg;
        fg.backgroundColor(is3d ? '#0f1b24' : '#fafcfc')
            .nodeId('id')
            .nodeRelSize(is3d ? 3 : 4)
            .nodeVal(n => (n.id === this.centerId ? 6 : 1) + n.degree)
            .nodeColor(n => this._nodeColor(n))
            .nodeLabel(n => this._nodeTooltip(n))
            .linkColor(l => this._linkColor(l))
            .linkWidth(l => this.pathLinks.has(l) ? 4 : this.hoverLinks.has(l) ? 2 : (is3d ? 0.6 : 1))
            .linkLabel(l => `${LINK_TYPES[l.type]?.label || l.type}${l.label && l.type !== 'parent' ? ' — ' + l.label : ''}${l.year ? ' (' + l.year + ')' : ''}`)
            .linkDirectionalParticles(l => l.type === 'parent' && (this.hoverLinks.has(l) || this.pathLinks.has(l)) ? 3 : 0)
            .linkDirectionalParticleWidth(is3d ? 2 : 3)
            .onNodeHover(n => this._hover(n))
            .onLinkHover(l => this._hoverLink(l))
            .onNodeClick(n => this.onNodeClick?.(n.id))
            // Recadrage automatique une fois la disposition stabilisée après chaque changement d'affichage.
            .cooldownTicks(200)
            .onEngineStop(() => { if(this._fitPending) { this._fitPending = false; this.zoomToFit(); } });
        if(is3d) {
            // L'aide de navigation intégrée est en anglais : remplacée par le title de l'option 3D (reseau.html).
            fg.linkOpacity(0.55).showNavInfo(false);
        } else {
            // Redessin continu : le surlignage au survol doit se voir même une fois la simulation figée.
            fg.autoPauseRedraw(false)
                .linkLineDash(l => (l.type === 'association' || l.type === 'coresidence') ? [3, 2] : null)
                .nodeCanvasObjectMode(() => 'after')
                .nodeCanvasObject((n, ctx, scale) => this._drawLabel(n, ctx, scale));
        }
        this._fitSize();
    }

    _nodeTooltip(n) {
        const dates = (n.birthYear || n.deathYear) ? ` (${n.birthYear || '?'}–${n.deathYear || ''})` : '';
        return `<strong>${escapeHtml(n.name)}</strong>${dates}<br>${n.degree} lien${n.degree > 1 ? 's' : ''}`;
    }

    _baseColor(n) {
        if(this.colorBy === 'sex') return SEX_COLORS[n.sex] || SEX_OTHER;
        return n.communityColor || COMMUNITY_OTHER;
    }

    _nodeColor(n) {
        if(this.pathIds.size && this.pathIds.has(n.id)) return PATH_COLOR;
        if(this.hoverIds.size && !this.hoverIds.has(n.id)) return FADED_NODE;
        if(!this.hoverIds.size && this.pathIds.size) return FADED_NODE;
        return this._baseColor(n);
    }

    _linkColor(l) {
        if(this.pathLinks.has(l)) return PATH_COLOR;
        if(this.hoverIds.size && !this.hoverLinks.has(l)) return FADED_LINK;
        if(!this.hoverIds.size && this.pathIds.size) return FADED_LINK;
        return LINK_TYPES[l.type]?.color || '#999';
    }

    // Étiquettes permanentes en 2D : personne centrale, chemin, survol et voisins ; toutes dès
    // qu'on zoome suffisamment.
    _drawLabel(n, ctx, scale) {
        const show = n.id === this.centerId || this.pathIds.has(n.id) || (this.hoverIds.size ? this.hoverIds.has(n.id) : scale > 2.5);
        if(!show) return;
        const size = 11 / scale;
        ctx.font = `${n.id === this.centerId ? 'bold ' : ''}${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const r = Math.sqrt((n.id === this.centerId ? 6 : 1) + n.degree) * 4;
        const label = n.birthYear ? `${n.name} (${n.birthYear})` : n.name;
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = 'rgba(250,252,252,0.9)';
        ctx.strokeText(label, n.x, n.y + r + 2 / scale);
        ctx.fillStyle = '#233f52';
        ctx.fillText(label, n.x, n.y + r + 2 / scale);
    }

    _hover(n) {
        this.hoverIds = new Set();
        this.hoverLinks = new Set();
        if(n) {
            this.hoverIds.add(n.id);
            this.data.links.forEach(l => {
                const s = idOf(l.source), t = idOf(l.target);
                if(s === n.id || t === n.id) { this.hoverLinks.add(l); this.hoverIds.add(s); this.hoverIds.add(t); }
            });
        }
        this.el.style.cursor = n ? 'pointer' : '';
        this._refresh();
    }

    _hoverLink(l) {
        this.hoverIds = new Set();
        this.hoverLinks = new Set();
        if(l) { this.hoverLinks.add(l); this.hoverIds.add(idOf(l.source)); this.hoverIds.add(idOf(l.target)); }
        this._refresh();
    }

    // En 3D les accesseurs ne sont réévalués que s'ils sont réaffectés (cf. exemple "highlight" de
    // 3d-force-graph) ; en 2D le redessin continu suffit.
    _refresh() {
        if(!this.fg || this.mode !== '3d') return;
        const fg = this.fg;
        fg.nodeColor(fg.nodeColor()).nodeVal(fg.nodeVal()).linkColor(fg.linkColor()).linkWidth(fg.linkWidth())
            .linkDirectionalParticles(fg.linkDirectionalParticles());
    }

    // Affiche le sous-ensemble `ids` du graphe complet, avec ses liens des types actifs. Les objets
    // nœuds déjà affichés sont réutilisés pour conserver leur position (continuité visuelle).
    show(graph, ids, activeTypes, centerId) {
        this.graph = graph;
        this.centerId = centerId;
        this.activeTypes = activeTypes;
        if(!this.fg) this._create();
        const byId = new Map(graph.nodes.map(n => [n.id, n]));
        const nextShown = new Map();
        ids.forEach(id => {
            const base = byId.get(id);
            if(!base) return;
            const prev = this.shownNodes.get(id);
            const node = prev || { id };
            Object.assign(node, { name: base.name, sex: base.sex, birthYear: base.birthYear, deathYear: base.deathYear,
                degree: base.degree, community: base.community, communityColor: base.communityColor });
            nextShown.set(id, node);
        });
        this.shownNodes = nextShown;
        const links = graph.links
            .filter(l => activeTypes.has(l.type) && nextShown.has(idOf(l.source)) && nextShown.has(idOf(l.target)))
            .map(l => ({ source: idOf(l.source), target: idOf(l.target), type: l.type, label: l.label, year: l.year, base: l }));
        this.data = { nodes: [...nextShown.values()], links };
        this._remapPath();
        this.hoverIds = new Set();
        this.hoverLinks = new Set();
        this._fitPending = true;
        this.fg.graphData(this.data);
        return { nodes: this.data.nodes.length, links: links.length };
    }

    setMode(mode) {
        if(mode === this.mode) return;
        this.mode = mode;
        // Nouveaux objets nœuds (3d-force-graph attache ses objets three.js aux données : les
        // réutiliser dans une autre instance les rendrait invisibles), positions conservées.
        const fresh = new Map();
        this.shownNodes.forEach((n, id) => fresh.set(id, { id, x: n.x, y: n.y, z: mode === '3d' ? (Math.random() - 0.5) * 50 : undefined }));
        this.shownNodes = fresh;
        this._create();
        if(this.graph) this.show(this.graph, [...fresh.keys()], this.activeTypes, this.centerId);
    }

    setColorBy(colorBy) {
        this.colorBy = colorBy;
        this._refresh();
    }

    // Chemin : liste d'ids et ensemble des liens de base (graph.links) à surligner.
    setPath(ids, baseLinks) {
        this.pathIdsList = ids || [];
        this.pathBaseLinks = new Set(baseLinks || []);
        this._remapPath();
        this._refresh();
    }

    _remapPath() {
        this.pathIds = new Set(this.pathIdsList || []);
        this.pathLinks = new Set(this.data.links.filter(l => this.pathBaseLinks?.has(l.base)));
    }

    zoomToFit() { this.fg?.zoomToFit(800, 40); }

    legendColors() {
        return { sex: SEX_COLORS, sexOther: SEX_OTHER, path: PATH_COLOR };
    }
}
