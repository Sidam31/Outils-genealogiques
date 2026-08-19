// --- VISUALIZATION ---
export class FanChart {
    constructor(id) {
        this.div = document.getElementById(id);
        this.map = null; this.fams = null; this.rootId = null;
        this.svg = null; this.g = null; this.zoom = null;
        this.descStartOffset = Math.PI / 2; // Valeur par défaut
        this.numDescChildren = 0; // Nombre d'enfants descendants
        this.continuousDomain = null; // Domaine réel [min,max] pour les échelles continues
        this.init();
        window.addEventListener('resize', () => { if(this.rootId && this.div.clientWidth > 0) { this.recenter(); this.render(); } });
    }

    init() {
        this.div.innerHTML = '';
        this.svg = d3.select(this.div).append('svg').attr('width','100%').attr('height','100%');
        this.g = this.svg.append('g');
        this.zoom = d3.zoom().scaleExtent([0.1, 5]).on('zoom', e => this.g.attr('transform', e.transform));
        this.svg.call(this.zoom);
        document.getElementById('resetBtn').onclick = () => {
            this.svg.transition().duration(750).call(this.zoom.transform, d3.zoomIdentity.translate(this.div.clientWidth/2, this.div.clientHeight/2));
        };
    }

    // Recentre le zoom/pan sur le milieu du canevas (changement de racine, resize, home)
    recenter() {
        const w = this.div.clientWidth, h = this.div.clientHeight;
        this.svg.call(this.zoom.transform, d3.zoomIdentity.translate(w/2, h/2));
    }

    setData(rootId, map, fams) {
        this.map = map; this.fams = fams; this.rootId = rootId;
        this.recenter();
        this.render();
    }

    // ANCETRES: 50% PERE (Gauche), 50% MERE (Droite)
    buildAnc(id, depth, max) {
        if(depth > max) return null;
        const i = this.map.get(id);
        const node = { ...(i || {name:'?', id:'DUMMY'}), children:[] };

        if(!i) return node; // Nœud vide pour combler l'espace

        // Force l'ordre: Père (index 0), Mère (index 1)
        // Si manquant, on ajoute un dummy pour maintenir la géométrie
        const f = i.fatherId ? this.buildAnc(i.fatherId, depth+1, max) : {id:'DUMMY', children:[], data:{}};
        const m = i.motherId ? this.buildAnc(i.motherId, depth+1, max) : {id:'DUMMY', children:[], data:{}};

        // On n'ajoute les enfants que si on n'est pas au max
        if (depth < max) {
            node.children.push(f);
            node.children.push(m);
        }
        return node;
    }

    buildDesc(id) {
        const i = this.map.get(id);
        if(!i) return null;
        const node = { ...i, children:[], isDesc:true };
        i.fams.forEach(fid => {
            const f = this.fams.get(fid);
            if(f) f.children.forEach(cid => {
                const c = this.map.get(cid);
                if(c) node.children.push({ ...c, children:[], isDesc:true });
            });
        });
        return node;
    }

    render() {
        this.g.selectAll("*").remove();
        const w = this.div.clientWidth, h = this.div.clientHeight;
        const r = Math.min(w,h)/2 - 50;

        const maxGen = parseInt(document.getElementById('depthSelect').value);
        const mode = document.getElementById('colorMode').value;
        const colorScale = this.getColorScale(mode, this.rootId);
        this.continuousDomain = this.getContinuousDomain(mode, this.rootId);

        // 1. ANCETRES : De part et d'autre de l'axe vertical (12h)
        // Paternel à gauche (9h-12h), Maternel à droite (12h-3h)
        const ancTree = this.buildAnc(this.rootId, 0, maxGen);
        const rootAnc = d3.hierarchy(ancTree);

        // Assigner les valeurs manuellement pour respecter la géométrie binaire
        // Chaque nœud occupe exactement la moitié de son parent
        this.assignPartitionValues(rootAnc, 0, Math.PI);

        // Décalage de -π/2 pour centrer sur 12h (axe vertical vers le haut)
        const arcAnc = d3.arc()
            .startAngle(d => d.x0 - Math.PI/2)
            .endAngle(d => d.x1 - Math.PI/2)
            .innerRadius(d => d.y0).outerRadius(d => d.y1);

        // Exclure la racine (depth 0) des arcs, elle sera dessinée comme un cercle
        const nodesAnc = rootAnc.descendants().filter(d => d.depth > 0 && d.data.id !== 'DUMMY' && d.data.name !== '?');
        this.drawPaths(nodesAnc, arcAnc, colorScale, mode, 'anc');

        // 2. DESCENDANTS : Symétriques autour de l'axe vertical (6h = -π/2 ou 3π/2 ou 270°)
        // Dans le système D3: 0 = 12h, π/2 = 3h, π = 6h (bas), -π/2 = 9h
        // Pour les descendants, on assigne manuellement les positions
        // pour centrer symétriquement autour de π (6h)
        const descTree = this.buildDesc(this.rootId);
        if(descTree && descTree.children.length > 0) {
            const numChildren = descTree.children.length;
            this.numDescChildren = numChildren;

            // Créer la hiérarchie juste pour avoir la structure
            const rootDesc = d3.hierarchy(descTree);

            // Angle par enfant - max 45° par enfant
            const maxSpan = Math.PI * 0.8;
            const anglePerChild = Math.min(Math.PI / 4, maxSpan / numChildren);
            const totalSpan = anglePerChild * numChildren;

            // Offset pour centrer sur π (6h)
            // On veut que le CENTRE de l'ensemble soit sur π
            this.descStartOffset = Math.PI - totalSpan / 2;

            // Rayons pour les descendants
            const innerR = 80;
            const outerR = r / 1.8;

            // Assigner manuellement les positions aux enfants
            rootDesc.y0 = 0;
            rootDesc.y1 = innerR;
            rootDesc.x0 = 0;
            rootDesc.x1 = totalSpan;

            if(rootDesc.children) {
                rootDesc.children.forEach((child, i) => {
                    // Chaque enfant occupe un segment égal
                    child.x0 = i * anglePerChild;
                    child.x1 = (i + 1) * anglePerChild;
                    child.y0 = innerR;
                    child.y1 = outerR;
                });
            }

            const arcDesc = d3.arc()
                .startAngle(d => d.x0 + this.descStartOffset)
                .endAngle(d => d.x1 + this.descStartOffset)
                .innerRadius(d => d.y0).outerRadius(d => d.y1);

            // Ne garder que les enfants (depth > 0), pas la racine
            const nodesDesc = rootDesc.descendants().filter(d => d.depth > 0);

            this.drawPaths(nodesDesc, arcDesc, colorScale, mode, 'desc');
        }

        // Dessiner le nœud racine comme un cercle complet (en dernier pour qu'il soit au-dessus)
        const rootData = this.map.get(this.rootId);
        if(rootData) {
            const radiusPerGen = r / (maxGen + 1);
            const rootRadius = radiusPerGen; // Rayon de la première génération

            this.g.append('circle')
                .attr('class', 'root-circle')
                .attr('cx', 0)
                .attr('cy', 0)
                .attr('r', rootRadius)
                .style('fill', this.fillColor(rootAnc, mode, colorScale))
                .style('stroke', '#fff')
                .style('stroke-width', '1px')
                .style('cursor', 'pointer')
                .on('click', () => document.dispatchEvent(new CustomEvent('changeroot', {detail: this.rootId})))
                .on('mouseover', (e) => this.tooltip(e, rootAnc))
                .on('mousemove', e => this.moveTooltip(e))
                .on('mouseout', () => this.hideTooltip());

            // Texte pour le nœud racine au centre
            const rootTextSel = this.g.append('text')
                .attr('class', 'root-text')
                .attr('x', 0)
                .attr('y', 0)
                .attr('text-anchor', 'middle')
                .attr('dy', '.35em')
                .style('font-size', '12px')
                .style('pointer-events', 'none');
            this.fitRootText(rootTextSel.node(), rootData, rootRadius);
        }

        this.legend(mode, colorScale);
    }

    // Assigner manuellement les positions x0, x1, y0, y1 pour respecter la structure binaire
    // Même si un ancêtre est manquant, l'espace lui est réservé
    assignPartitionValues(node, startAngle, angleSpan, depth = 0, maxRadius = null) {
        if(maxRadius === null) {
            const w = this.div.clientWidth, h = this.div.clientHeight;
            maxRadius = Math.min(w, h) / 2 - 50;
        }

        const maxGen = parseInt(document.getElementById('depthSelect').value);
        const radiusPerGen = maxRadius / (maxGen + 1);

        node.x0 = startAngle;
        node.x1 = startAngle + angleSpan;
        node.y0 = depth * radiusPerGen;
        node.y1 = (depth + 1) * radiusPerGen;
        node.depth = depth;

        // Toujours diviser en 2 pour les ancêtres (structure binaire)
        if(node.children && node.children.length === 2) {
            const childAngle = angleSpan / 2;
            // Enfant 0 = Père (première moitié)
            this.assignPartitionValues(node.children[0], startAngle, childAngle, depth + 1, maxRadius);
            // Enfant 1 = Mère (seconde moitié)
            this.assignPartitionValues(node.children[1], startAngle + childAngle, childAngle, depth + 1, maxRadius);
        }
    }

    drawPaths(nodes, arc, colorScale, mode, type) {
        const self = this;
        this.g.selectAll(`path.${type}`)
            .data(nodes)
            .join('path')
            .attr('class', type)
            .attr('d', arc)
            .style('fill', d => this.fillColor(d, mode, colorScale))
            .style('stroke', '#fff')
            .style('cursor', 'pointer')
            .on('click', (e,d) => document.dispatchEvent(new CustomEvent('changeroot',{detail:d.data.id})))
            .on('mouseover', (e,d) => this.tooltip(e,d))
            .on('mousemove', e => this.moveTooltip(e))
            .on('mouseout', () => this.hideTooltip());

        // Filtrer les nœuds avec suffisamment d'espace pour le texte
        const textNodes = nodes.filter(d => {
            const arcLength = (d.x1 - d.x0) * (d.y0 + d.y1) / 2;
            const radialSize = d.y1 - d.y0;
            return arcLength > 0.15 || radialSize > 20;
        });

        this.g.selectAll(`text.${type}`)
            .data(textNodes)
            .join('text')
            .attr('class', d => `${type} gen-${d.depth}`)
            .attr('transform', d => {
                let ang = (d.x0 + d.x1) / 2;
                let offsetAng = 0;

                if(type === 'anc') {
                    offsetAng = -Math.PI / 2; // Décalage pour ancêtres (9h-3h)
                    if(d.depth === 0) return `translate(0,0)`;
                } else {
                    offsetAng = this.descStartOffset; // Utiliser l'offset des descendants
                }

                ang += offsetAng;
                let r = (d.y0 + d.y1) / 2;
                const angDeg = ang * 180 / Math.PI;

                // Normaliser l'angle entre -180 et 180
                let normAng = angDeg;
                while(normAng > 180) normAng -= 360;
                while(normAng < -180) normAng += 360;

                // Côté paternel = gauche = angles entre -90° et 0° (après offset)
                const isLeftSide = (normAng < 0 && normAng >= -90);
                // Côté maternel = droite = angles entre 0° et 90°
                const isRightSide = (normAng >= 0 && normAng <= 90);

                // Décalage radial pour génération 4 (homme/femme sur des rayons légèrement différents)
                if(type === 'anc' && d.depth === 4) {
                    const midAngle = (d.x0 + d.x1) / 2;
                    const parentMid = d.parent ? (d.parent.x0 + d.parent.x1) / 2 : midAngle;
                    const isFirst = midAngle < parentMid;
                    r += isFirst ? -8 : 8;
                }

                // DESCENDANTS: texte radial si plus de 4 enfants
                if(type === 'desc' && this.numDescChildren > 4) {
                    // Texte radial pour les descendants
                    // Le texte doit pointer vers l'extérieur, lisible
                    // Pour le côté gauche (6h-9h): normAng entre 90 et 180
                    // Pour le côté droit (3h-6h): normAng entre 90 et 180 aussi (après offset)
                    const flipText = (normAng > 90 || normAng < -90);
                    const textRot = flipText ? 180 : 0;
                    return `rotate(${angDeg - 90}) translate(${r},0) rotate(${textRot})`;
                }

                // Pour les générations >= 5 en ancêtres, texte radial (perpendiculaire à l'arc)
                if(type === 'anc' && d.depth >= 5) {
                    // Texte radial : le texte suit le rayon
                    // rotate(angDeg - 90) puis translate(r, 0) positionne sur le rayon
                    //
                    // Côté paternel (normAng entre -90 et 0): angDeg - 90 entre -180° et -90°
                    //   -> Le texte pointe vers le bas/gauche, il faut flipper de 180°
                    // Côté maternel (normAng entre 0 et 90): angDeg - 90 entre -90° et 0°
                    //   -> Le texte pointe vers le haut/droite, pas de flip nécessaire
                    const textRot = isLeftSide ? 180 : 0;
                    return `rotate(${angDeg - 90}) translate(${r},0) rotate(${textRot})`;
                }

                // Décalage vertical pour génération 5 (mari/femme)
                let verticalOffset = 0;
                if(type === 'anc' && d.depth === 5) {
                    const midAngle = (d.x0 + d.x1) / 2;
                    const parentMid = d.parent ? (d.parent.x0 + d.parent.x1) / 2 : midAngle;
                    const isFirst = midAngle < parentMid;
                    verticalOffset = isFirst ? -2 : 2;
                }

                // Texte tangentiel (le long de l'arc) pour générations < 5 et descendants <= 4
                // Flip pour que le texte soit toujours lisible (pas à l'envers)
                const flipText = (normAng > 90 || normAng < -90);
                const textRot = flipText ? 180 : 0;
                return `rotate(${angDeg - 90}) translate(${r},${verticalOffset}) rotate(${90 + textRot})`;
            })
            .attr('text-anchor', 'middle')
            .attr('dy', '.35em')
            .each(function(d) { self.fitText(this, d, type); });
    }

    // Vrai si la personne doit être protégée : vivante (pas de décès acté) ou décédée depuis
    // moins de 25 ans. Convention alignée sur getHistoricalWindow (timeline.js) : sans date de
    // décès, on considère la personne comme probablement vivante.
    isPrivate(i) {
        if(!i || i.id === 'DUMMY') return false;
        const deathYear = i.death?.year;
        if(deathYear == null) return true;
        return (new Date().getFullYear() - deathYear) < 25;
    }

    getPrivacyMode() {
        const el = document.getElementById('privacyMode');
        return el ? el.value : '';
    }

    // Nom formaté (HTML) pour l'infobulle, respectant le mode de protection en cours.
    displayNameHtml(i) {
        const words = this.getDisplayWords(i);
        if(words.length < 2) return words[0];
        if(this.getPrivacyMode() === 'blur' && this.isPrivate(i)) {
            return `${words[0]} <span class="blurred-surname">${words[1]}</span>`;
        }
        return words.join(' ');
    }

    // Découpe le nom en mots utilisables pour l'affichage : [prénom, patronyme] ou [mot unique].
    // En mode "mask", le patronyme des personnes protégées (voir isPrivate) est remplacé par un
    // symbole neutre ; en mode "blur" les mots restent intacts, le flou est appliqué au rendu.
    getDisplayWords(i) {
        const fullName = i && i.name;
        if(!fullName || fullName === '?') return ['?'];
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        if(parts.length === 0) return ['?'];
        const words = parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]];
        if(words.length > 1 && this.getPrivacyMode() === 'mask' && this.isPrivate(i)) {
            words[words.length - 1] = '•••';
        }
        return words;
    }

    // Ajuste le texte d'un label d'arc pour qu'il tienne dans l'espace disponible :
    // essaie d'abord un retour à la ligne (prénom / patronyme), puis réduit la taille de police,
    // et en dernier recours tronque avec une ellipse.
    fitText(el, d, type) {
        const i = d.data;
        const words = this.getDisplayWords(i);
        const sel = d3.select(el);
        sel.text(null);
        const blurSurname = words.length > 1 && this.getPrivacyMode() === 'blur' && this.isPrivate(i);

        const r = (d.y0 + d.y1) / 2;
        const angularSpan = Math.max(0, d.x1 - d.x0);
        const radialThickness = Math.max(0, d.y1 - d.y0);
        const tangentialLen = Math.max(1, angularSpan * r);

        const isRadial = (type === 'anc' && d.depth >= 5) || (type === 'desc' && this.numDescChildren > 4);
        const availW = Math.max(4, isRadial ? radialThickness : tangentialLen);
        const availH = Math.max(4, isRadial ? tangentialLen : radialThickness);

        const baseFontSize = parseFloat(window.getComputedStyle(el).fontSize) || 7;
        const minSize = 3.5;
        const lineHeight = 1.1;

        // Le retour à la ligne n'a de sens que pour le texte tangentiel : en orientation
        // radiale, l'espace tangentiel est déjà la dimension la plus contrainte.
        const canTwoLine = !isRadial && words.length === 2 && availH >= baseFontSize * lineHeight * 1.9;

        if(canTwoLine) {
            const t1 = sel.append('tspan').attr('x', 0).attr('dy', '-0.1em').text(words[0]);
            const t2 = sel.append('tspan').attr('x', 0).attr('dy', `${lineHeight}em`).text(words[1])
                .classed('blurred-surname', blurSurname);
            let w = Math.max(t1.node().getComputedTextLength(), t2.node().getComputedTextLength());
            if(w > availW) {
                const scale = Math.max(availW / w, minSize / baseFontSize);
                sel.style('font-size', Math.max(baseFontSize * scale, minSize) + 'px');
                w = Math.max(t1.node().getComputedTextLength(), t2.node().getComputedTextLength());
                if(w > availW) {
                    this.truncateToFit(t1.node(), words[0], availW);
                    this.truncateToFit(t2.node(), words[1], availW);
                }
            }
            return;
        }

        const full = words.join(' ');
        if(blurSurname) {
            sel.append('tspan').text(words[0] + ' ');
            sel.append('tspan').classed('blurred-surname', true).text(words[1]);
        } else {
            sel.text(full);
        }
        const w = el.getComputedTextLength();
        if(w > availW) {
            const scale = availW / w;
            const newSize = baseFontSize * scale;
            if(newSize >= minSize) {
                sel.style('font-size', newSize + 'px');
            } else {
                sel.style('font-size', minSize + 'px');
                // Le repli par troncature réécrit le texte brut de l'élément : le flou par mot
                // (tspan dédié) est perdu pour ces rares segments minuscules, sans conséquence
                // visuelle vu leur taille.
                this.truncateToFit(el, full, availW);
            }
        }
    }

    // Recherche binaire du plus long préfixe + "…" qui tient dans availW (largeur en unités SVG)
    truncateToFit(node, text, availW) {
        if(node.getComputedTextLength() <= availW) return text;
        let lo = 0, hi = text.length, best = '…';
        while(lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const candidate = mid > 0 ? text.slice(0, mid) + '…' : '…';
            node.textContent = candidate;
            if(node.getComputedTextLength() <= availW) { best = candidate; lo = mid + 1; }
            else hi = mid - 1;
        }
        node.textContent = best;
        return best;
    }

    // Ajuste le texte du nœud racine (cercle central) pour qu'il tienne dans son diamètre
    fitRootText(el, i, radius) {
        const words = this.getDisplayWords(i);
        const sel = d3.select(el);
        sel.text(null);
        const blurSurname = words.length > 1 && this.getPrivacyMode() === 'blur' && this.isPrivate(i);

        const availW = Math.max(4, radius * 1.6);
        const baseFontSize = parseFloat(window.getComputedStyle(el).fontSize) || 12;
        const minSize = 6;
        const lineHeight = 1.1;
        const canTwoLine = words.length === 2 && radius * 2 >= baseFontSize * lineHeight * 1.9;

        if(canTwoLine) {
            const t1 = sel.append('tspan').attr('x', 0).attr('dy', '-0.1em').text(words[0]);
            const t2 = sel.append('tspan').attr('x', 0).attr('dy', `${lineHeight}em`).text(words[1])
                .classed('blurred-surname', blurSurname);
            let w = Math.max(t1.node().getComputedTextLength(), t2.node().getComputedTextLength());
            if(w > availW) {
                const scale = Math.max(availW / w, minSize / baseFontSize);
                sel.style('font-size', Math.max(baseFontSize * scale, minSize) + 'px');
                w = Math.max(t1.node().getComputedTextLength(), t2.node().getComputedTextLength());
                if(w > availW) {
                    this.truncateToFit(t1.node(), words[0], availW);
                    this.truncateToFit(t2.node(), words[1], availW);
                }
            }
            return;
        }

        if(blurSurname) {
            sel.append('tspan').text(words[0] + ' ');
            sel.append('tspan').classed('blurred-surname', true).text(words[1]);
        } else {
            sel.text(words.join(' '));
        }
        const w = el.getComputedTextLength();
        if(w > availW) {
            const scale = availW / w;
            sel.style('font-size', Math.max(baseFontSize * scale, minSize) + 'px');
        }
    }

    getColorScale(mode, rootId) {
        if(mode==='branch' || mode.startsWith('age_') || mode==='child_count') return null; // Pas de scale ordinal

        // Collecte toutes les valeurs uniques pour la légende et les couleurs
        const vals = new Set();
        const acc = this.getAccessor(mode);
        if(!acc) return null;

        // On scanne l'arbre ancêtre complet
        const scan = (id, d) => {
            if(d>10) return;
            const i = this.map.get(id);
            if(i) {
                const v = acc({data:i});
                if(v && v!=='Inconnu') vals.add(v);
                if(i.fatherId) scan(i.fatherId, d+1);
                if(i.motherId) scan(i.motherId, d+1);
            }
        };
        scan(rootId, 0);

        const sorted = Array.from(vals).sort();

        // Créer une palette étendue avec transparence pour les éléments au-delà de 10
        const baseColors = d3.schemeTableau10;
        const extendedColors = sorted.map((v, i) => {
            const baseColor = baseColors[i % baseColors.length];
            if(i < 10) {
                return baseColor; // Couleurs pleines pour les 10 premiers
            } else {
                // Ajouter de la transparence pour les suivants
                const opacity = 0.6;
                const rgb = d3.rgb(baseColor);
                return `rgba(${rgb.r},${rgb.g},${rgb.b},${opacity})`;
            }
        });

        return d3.scaleOrdinal().domain(sorted).range(extendedColors);
    }

    // Calcule le domaine réel [min,max] des valeurs présentes dans l'arbre pour les modes continus
    getContinuousDomain(mode, rootId) {
        const accessors = {
            age_death: i => i.ageDeath,
            age_marr: i => i.ageMarr,
            age_first_child: i => i.ageFirstChild,
            child_count: i => i.childCount
        };
        const acc = accessors[mode];
        if(!acc || !this.map) return null;

        let min = Infinity, max = -Infinity;
        const scan = (id, d) => {
            if(d>10) return;
            const i = this.map.get(id);
            if(!i) return;
            const v = acc(i);
            if(v != null) { if(v < min) min = v; if(v > max) max = v; }
            if(i.fatherId) scan(i.fatherId, d+1);
            if(i.motherId) scan(i.motherId, d+1);
        };
        scan(rootId, 0);
        if(!isFinite(min)) return null;
        if(min === max) { min -= 1; max += 1; }
        return [min, max];
    }

    getAccessor(mode) {
        const d = n => n.data;
        if(mode.endsWith('_dept')) {
            return n => {
                if(mode.startsWith('b')) return d(n).birth.geo?.dept;
                if(mode.startsWith('d')) return d(n).death.geo?.dept;
                if(mode.startsWith('m')) return d(n).marrGeo?.dept;
            };
        }
        if(mode.endsWith('_reg')) {
            // Pour les régions: si pas de région mais pays != France, afficher le pays
            return n => {
                let geo;
                if(mode.startsWith('b')) geo = d(n).birth.geo;
                else if(mode.startsWith('d')) geo = d(n).death.geo;
                else if(mode.startsWith('m')) geo = d(n).marrGeo;

                if(geo?.region) return geo.region;
                // Si pas de région mais pays étranger, retourner le pays
                if(geo?.country && geo.country !== 'France') return geo.country;
                return null;
            };
        }
        if(mode.endsWith('_country')) {
            return n => {
                if(mode.startsWith('b')) return d(n).birth.geo?.country;
                if(mode.startsWith('d')) return d(n).death.geo?.country;
                if(mode.startsWith('m')) return d(n).marrGeo?.country;
            };
        }
        return null;
    }

    fillColor(d, mode, scale) {
        if(mode === 'branch') {
            if(d.data.isDesc) return '#ddd';
            if(d.depth === 0) return '#fff';
            // Remonter au niveau 1 pour déterminer la branche
            let p = d;
            while(p.depth > 1) p = p.parent;
            // Après rotation de -π/2 :
            // Paternel (gauche, 9h-12h) correspond à x0 < π/2 dans l'espace partition
            // Maternel (droite, 12h-3h) correspond à x0 >= π/2
            return (p.x0 < Math.PI/2)
                ? d3.interpolateBlues(0.2 + d.depth/10)
                : d3.interpolateReds(0.2 + d.depth/10);
        }

        const dat = d.data;
        const sc = (v, s) => (v!=null) ? s(v) : '#f0f0f0';
        const dom = this.continuousDomain;
        if(mode==='age_death') return sc(dat.ageDeath, d3.scaleSequential(d3.interpolateTurbo).domain(dom || [0, 100]));
        if(mode==='age_marr') return sc(dat.ageMarr, d3.scaleSequential(d3.interpolateViridis).domain(dom || [18, 50]));
        if(mode==='age_first_child') return sc(dat.ageFirstChild, d3.scaleSequential(d3.interpolatePlasma).domain(dom || [18, 50]));
        if(mode==='child_count') return sc(dat.childCount, d3.scaleSequential(d3.interpolateInferno).domain(dom || [0, 10]));

        // Geo
        const acc = this.getAccessor(mode);
        if(acc && scale) {
            const v = acc(d);
            return (v && v!=='Inconnu') ? scale(v) : '#eee';
        }
        return '#eee';
    }

    legend(mode, scale) {
        const leg = document.getElementById('legend');
        leg.innerHTML = '';
        const txt = document.querySelector(`#colorMode option[value="${mode}"]`).innerText;
        leg.innerHTML = `<strong>${txt}</strong>`;
        leg.style.display = 'block';

        if(mode==='branch') {
             leg.innerHTML += `<div class="leg-item"><div class="dot" style="background:#4292c6"></div>Paternel (Gauche)</div>`;
             leg.innerHTML += `<div class="leg-item"><div class="dot" style="background:#ef3b2c"></div>Maternel (Droite)</div>`;
             leg.innerHTML += `<div class="leg-item"><div class="dot" style="background:#ddd"></div>Descendants</div>`;
        } else if(scale) {
            const domain = scale.domain();
            if(domain.length > 50) {
                leg.innerHTML += `<div>Trop de valeurs (${domain.length})</div>`;
            } else {
                domain.forEach((v, i) => {
                    const color = scale(v);
                    // const opacity = i >= 10 ? ' (transp.)' : '';
                    leg.innerHTML += `<div class="leg-item"><div class="dot" style="background:${color}"></div>${v}</div>`;
                });
            }
            if(domain.length === 0) leg.innerHTML += `<div>Aucune donnée</div>`;
        } else {
            // Légende pour les échelles continues (âges, nombre d'enfants) - domaine basé sur les données réelles
            let colorInterpolator = d3.interpolateTurbo;
            let defaultDomain = [0, 100];
            if(mode === 'age_death') { colorInterpolator = d3.interpolateTurbo; defaultDomain = [0, 100]; }
            else if(mode === 'age_marr') { colorInterpolator = d3.interpolateViridis; defaultDomain = [15, 50]; }
            else if(mode === 'age_first_child') { colorInterpolator = d3.interpolatePlasma; defaultDomain = [15, 50]; }
            else if(mode === 'child_count') { colorInterpolator = d3.interpolateInferno; defaultDomain = [0, 10]; }

            const [minVal, maxVal] = this.continuousDomain || defaultDomain;

            // Créer un dégradé avec les vraies couleurs
            const stops = [];
            for(let i = 0; i <= 10; i++) {
                const t = i / 10;
                stops.push(`${colorInterpolator(t)} ${t * 100}%`);
            }
            leg.innerHTML += `<div style="background:linear-gradient(90deg, ${stops.join(', ')}); height:12px; width:100%; margin:5px 0; border-radius:2px;"></div>`;
            leg.innerHTML += `<div style="display:flex; justify-content:space-between"><span>${minVal}</span><span>${maxVal}</span></div>`;
        }
    }

    tooltip(e, d) {
        const t = document.getElementById('tooltip');
        const i = d.data;
        t.style.opacity = 1;
        const row = (l,v,r) => v ? `<div class="tt-row"><span class="tt-lbl">${l}</span><span>${v}</span></div>${r?`<div class="tt-raw">"${r}"</div>`:''}` : '';
        const pl = (g) => g ? (g.dept||g.country||'') : '';
        t.innerHTML = `<strong>${this.displayNameHtml(i)}</strong>
            ${row('Naissance', (i.birth?.year||'')+' '+pl(i.birth?.geo), i.birth?.geo?.raw)}
            ${row('Décès', (i.death?.year||'')+' '+pl(i.death?.geo)+(i.ageDeath?` (${i.ageDeath} ans)`:''), i.death?.geo?.raw)}
            ${row('Enfants', i.childCount ? `${i.childCount}${i.childrenYears?.length ? ' (' + i.childrenYears.join(', ') + ')' : ''}` : null)}
            ${row('Mariage', (i.marrYear||'')+' '+(i.marrGeo?.dept||'')+(i.ageMarr?` (${i.ageMarr} ans)`:''), i.marrGeo?.raw)}`;
        this.moveTooltip(e);
    }
    moveTooltip(e) {
        const t = document.getElementById('tooltip');
        t.style.left = Math.min(e.pageX+15, window.innerWidth-320) + 'px';
        t.style.top = Math.min(e.pageY+15, window.innerHeight-250) + 'px';
    }
    hideTooltip() { document.getElementById('tooltip').style.opacity = 0; }
}
