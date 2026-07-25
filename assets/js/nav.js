// --- HEADER COMMUN (navigation entre les pages) ---
const TOOLS = [
    { href: 'arbre.html', icon: '🌳', label: 'Arbre éventail', page: 'arbre' },
    { href: 'visualisation.html', icon: '📊', label: 'Visualisation', page: 'visualisation' },
    { href: 'qualite.html', icon: '🔍', label: 'Analyse Qualité', page: 'qualite' },
    { href: 'deces-manquants.html', icon: '⚰️', label: 'Décès manquants', page: 'deces' },
    { href: 'recensements.html', icon: '📋', label: 'Recensements', page: 'recensements' },
    { href: 'parentes.html', icon: '🧬', label: 'Parentés hyp.', page: 'parentes' },
];

// Monte le <header> commun dans #appHeader et renvoie un slot #pageControls que chaque page
// remplit avec ses propres contrôles (ex: recherche + profondeur pour l'Arbre éventail).
export function renderHeader(activePage) {
    const header = document.getElementById('appHeader');
    if(!header) return { controlsSlot: null };
    header.innerHTML = `
        <h1>🔎 VisuGedcom</h1>
        <nav class="tabs">
            ${TOOLS.map(t => `<a class="tab-btn${t.page === activePage ? ' active' : ''}" href="${t.href}">${t.icon} ${t.label}</a>`).join('')}
        </nav>
        <div class="ctrl" id="pageControls"></div>
        <div class="ctrl"><a class="tab-btn" href="index.html" title="Charger un autre fichier GEDCOM">📁 Changer de fichier</a></div>
    `;
    return { controlsSlot: document.getElementById('pageControls') };
}
