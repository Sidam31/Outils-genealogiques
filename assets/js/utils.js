// --- UTILITAIRES PARTAGÉS ---
const MONTH_LABELS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Date complète lisible ("12 mai 1900") quand le jour/mois est connu (voir GedcomParser, qui ne
// les extrait que pour une date non approximative) ; repli sur la seule année ("1900", "1900
// (env.)") sinon — même convention d'affichage "(env.)" que le reste de l'app pour une date
// approximative (ABT/CAL/EST GEDCOM).
export function formatFullDate(evt) {
    if (!evt || evt.year == null) return '-';
    if (evt.day != null && evt.month != null) return `${evt.day} ${MONTH_LABELS_FR[evt.month]} ${evt.year}`;
    return `${evt.year}${evt.approx ? ' (env.)' : ''}`;
}

export function getEventLabel(code) {
    const labels = { 'BIRT':'Naissance', 'DEAT':'Décès', 'MARR':'Mariage', 'BURI':'Inhumation', 'BAPM':'Baptême', 'CENS':'Recensement', 'RESI':'Résidence', 'TUTELLE':'Tutelle' };
    return labels[code] || code;
}
export function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- Colonnes "Vérifié"/"Commentaire" (recherche.html : décès manquants, recensement, successions,
// mariage) : annotation manuelle libre, conservée dans le cache navigateur (localStorage), pas dans
// le GEDCOM ni un export - sert à cocher/noter au fil de la vérification manuelle des pistes sans
// perdre l'état d'une session à l'autre sur le même navigateur. storeKey isole les 4 volets entre eux
// (une clé localStorage par volet) ; rowId (person.id ou fam.id) est stable d'un rechargement à
// l'autre tant que le même GEDCOM est utilisé.
export function loadVerifStore(storeKey) {
    try {
        return JSON.parse(localStorage.getItem(storeKey)) || {};
    } catch (e) { return {}; }
}
export function getVerifEntry(storeKey, rowId) {
    return loadVerifStore(storeKey)[rowId] || { verified: false, comment: '' };
}
export function saveVerifEntry(storeKey, rowId, patch) {
    const store = loadVerifStore(storeKey);
    const entry = Object.assign({ verified: false, comment: '' }, store[rowId], patch);
    // Rien à garder pour une ligne jamais annotée : évite de faire grossir le cache indéfiniment
    // au fil des rechargements avec des entrées vides.
    if (!entry.verified && !entry.comment) {
        delete store[rowId];
    } else {
        store[rowId] = entry;
    }
    localStorage.setItem(storeKey, JSON.stringify(store));
}
export function verifCells(storeKey, rowId) {
    const entry = getVerifEntry(storeKey, rowId);
    const idAttr = escapeHtml(String(rowId));
    return `
        <td style="text-align:center;"><input type="checkbox" class="verif-checkbox" data-store="${storeKey}" data-row-id="${idAttr}"${entry.verified ? ' checked' : ''}></td>
        <td><input type="text" class="verif-comment" data-store="${storeKey}" data-row-id="${idAttr}" value="${escapeHtml(entry.comment)}" placeholder="Commentaire..." style="width:100%; min-width:120px; box-sizing:border-box; font:inherit; padding:2px 4px;"></td>
    `;
}
// Délégation d'évènements (un seul écouteur par tbody, posé une fois - pas à chaque rendu, la table
// étant entièrement reconstruite à chaque tri/filtre) : "change" suffit pour la case à cocher, mais
// "blur" (qui ne bouillonne pas, d'où la phase de capture) pour le commentaire - sauvegarder à chaque
// frappe (evt "input") réécrirait le cache en boucle inutilement.
export function wireVerifCellEvents(tbody) {
    tbody.addEventListener('change', (e) => {
        if (!e.target.classList.contains('verif-checkbox')) return;
        saveVerifEntry(e.target.dataset.store, e.target.dataset.rowId, { verified: e.target.checked });
    });
    tbody.addEventListener('blur', (e) => {
        if (!e.target.classList || !e.target.classList.contains('verif-comment')) return;
        saveVerifEntry(e.target.dataset.store, e.target.dataset.rowId, { comment: e.target.value });
    }, true);
}

// Remonte la lignée directe (père/mère) depuis rootId et renvoie la liste des identifiants (racine incluse).
export function getAncestorIds(individuals, rootId) {
    const ids = [];
    const seen = new Set();
    function scan(id, depth) {
        if(!id || depth > 15 || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
        const i = individuals.get(id);
        if(!i) return;
        scan(i.fatherId, depth + 1);
        scan(i.motherId, depth + 1);
    }
    scan(rootId, 0);
    return ids;
}

// Numérotation Sosa-Stradonitz depuis rootId (Sosa 1) : père de n -> 2n, mère de n -> 2n+1.
// N'a de sens que par rapport à une personne racine donnée (contrairement à "ID"), d'où le retour
// sous forme de Map plutôt qu'un champ permanent sur les individus.
export function getSosaMap(individuals, rootId) {
    const sosa = new Map();
    function assign(id, n, depth) {
        if(!id || depth > 20 || sosa.has(id)) return;
        sosa.set(id, n);
        const i = individuals.get(id);
        if(!i) return;
        assign(i.fatherId, n * 2, depth + 1);
        assign(i.motherId, n * 2 + 1, depth + 1);
    }
    assign(rootId, 1, 0);
    return sosa;
}

// Moyenne ET médiane : la médiane + son intervalle interquartile (25e-75e percentile) donnent une
// lecture robuste aux valeurs extrêmes ; la moyenne reste affichée à côté car un écart entre les
// deux est lui-même un signal utile (distribution asymétrique, quelques âges aberrants, etc.).
// std (écart-type) est fourni pour les graphiques qui préfèrent un corridor moyenne±écart-type
// classique plutôt que le corridor interquartile (ex. jour de la semaine du mariage).
export function computeStats(values) {
    const n = values.length;
    if(n === 0) return { mean: null, median: null, p25: null, p75: null, std: null, n: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    const sorted = [...values].sort((a, b) => a - b);
    const quantile = q => {
        const pos = (sorted.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
    };
    return { mean, median: quantile(0.5), p25: quantile(0.25), p75: quantile(0.75), std: Math.sqrt(variance), n };
}
export function decadeOf(year) { return Math.floor(year / 10) * 10; }
export function centuryOf(year) { return Math.ceil(year / 100); }
export function periodOf(year, size) { return Math.floor(year / size) * size; }

// Libellé français usuel d'un siècle ("XIXe siècle"), cohérent avec les commentaires déjà présents
// ailleurs dans le code (ex. geo.js, recherche.js) plutôt qu'un simple "19e siècle".
const ROMAN_DIGITS = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
export function toRoman(n) {
    let result = '';
    ROMAN_DIGITS.forEach(([val, sym]) => { while(n >= val) { result += sym; n -= val; } });
    return result;
}
export function centuryLabel(century) { return `${toRoman(century)}${century === 1 ? 'er' : 'e'} siècle`; }

// Jours de la semaine, convention française (1=lundi...7=dimanche) — index 0 du tableau = lundi.
// À utiliser avec GedcomParser.getWeekday(), qui renvoie 0=dimanche...6=samedi (convention JS) :
// convertir via `weekday === 0 ? 7 : weekday` avant de piocher dans ce tableau (WEEKDAY_LABELS[iso-1]).
export const WEEKDAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

// --- COPIE D'IMAGE DANS LE PRESSE-PAPIER ---
// Copie un Blob PNG dans le presse-papier. Le Clipboard API n'est disponible qu'en contexte
// sécurisé (https/localhost) : en local (file://) il bascule automatiquement sur un téléchargement.
export async function copyBlobOrDownload(blob, filename) {
    if(!blob) throw new Error('Génération de l\'image échouée');
    if(navigator.clipboard && window.ClipboardItem) {
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            return 'copied';
        } catch(err) {
            // Permission refusée ou contexte non sécurisé : on bascule sur le téléchargement.
        }
    }
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(dlUrl);
    return 'downloaded';
}

// Sérialise un <svg> (graphiques D3) en PNG.
export async function copySvgAsPng(svgEl, filename) {
    const width = svgEl.clientWidth || parseInt(svgEl.getAttribute('width')) || 500;
    const height = svgEl.clientHeight || parseInt(svgEl.getAttribute('height')) || 300;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    const svgString = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const scale = 2;
    const img = new Image();
    try {
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    } finally {
        URL.revokeObjectURL(url);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return copyBlobOrDownload(blob, filename);
}

// Capture un <canvas> existant (ex: la carte MapLibre) en PNG.
// Nécessite que le canvas ait été créé avec preserveDrawingBuffer:true (cas de la carte du monde).
export async function copyCanvasAsPng(canvasEl, filename) {
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    return copyBlobOrDownload(blob, filename);
}

// Câble tous les boutons .chart-copy-btn présents sur la page (appelé une fois au chargement).
// Détecte automatiquement si la cible est un graphique D3 (<svg>) ou une carte MapLibre (<canvas>).
export function wireCopyButtons() {
    document.querySelectorAll('.chart-copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const targetId = btn.dataset.target;
            const target = document.getElementById(targetId);
            const svg = target?.querySelector('svg');
            const canvas = target?.querySelector('canvas');
            if(!svg && !canvas) return;
            const original = btn.textContent;
            btn.disabled = true;
            try {
                const result = svg ? await copySvgAsPng(svg, `${targetId}.png`) : await copyCanvasAsPng(canvas, `${targetId}.png`);
                btn.textContent = result === 'copied' ? '✅' : '⬇️';
            } catch(err) {
                console.error('Copie image échouée:', err);
                btn.textContent = '⚠️';
            }
            setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
        });
    });
}

// --- EXPORT CSV ---
// Génère et télécharge un CSV (avec BOM pour qu'Excel reconnaisse l'UTF-8), à partir d'une liste
// d'en-têtes et d'un tableau de lignes (tableaux de valeurs déjà formatées en texte).
export function downloadCsv(filename, headers, rows) {
    const BOM = "﻿";
    const esc = v => {
        const s = (v == null) ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvContent = BOM + [headers, ...rows].map(row => row.map(esc).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
