// --- HEADER COMMUN (navigation entre les pages) ---
const TOOLS = [
    { href: 'arbre.html', icon: '🌳', label: 'Arbre éventail', page: 'arbre' },
    { href: 'visualisation.html', icon: '📊', label: 'Visualisation', page: 'visualisation' },
    { href: 'qualite.html', icon: '🔍', label: 'Analyse Qualité', page: 'qualite' },
    { href: 'deces-manquants.html', icon: '⚰️', label: 'Décès manquants', page: 'deces' },
    { href: 'recensements.html', icon: '📋', label: 'Recensements', page: 'recensements' },
    { href: 'parentes.html', icon: '🧬', label: 'Parentés hyp.', page: 'parentes' },
    { href: 'rues-paris.html', icon: '📜', label: 'Rues de Paris', page: 'rues-paris' },
];

// Monte le <header> commun dans #appHeader et renvoie un slot #pageControls que chaque page
// remplit avec ses propres contrôles (ex: recherche + profondeur pour l'Arbre éventail).
export function renderHeader(activePage) {
    const header = document.getElementById('appHeader');
    if(!header) return { controlsSlot: null };
    // Un export HTML autonome (voir export-html.js) est un instantané figé d'un fichier précis :
    // "Changer de fichier" y renverrait vers un index.html sans données, ce qui n'a pas de sens ici.
    const isLockedExport = !!document.getElementById('embeddedGedcomData');
    header.innerHTML = `
        <h1>🔎 VisuGedcom</h1>
        <nav class="tabs">
            ${TOOLS.map(t => `<a class="tab-btn${t.page === activePage ? ' active' : ''}" href="${t.href}">${t.icon} ${t.label}</a>`).join('')}
        </nav>
        <div class="ctrl" id="pageControls"></div>
        ${isLockedExport ? '' : '<div class="ctrl"><a class="tab-btn" href="index.html" title="Charger un autre fichier GEDCOM">📁 Changer de fichier</a></div>'}
        <div class="ctrl app-credit"><a href="https://www.lecentredegenealogie.fr/" target="_blank" rel="noopener" title="Le Centre de généalogie — site">🏛️ Le Centre de généalogie</a> · <a href="https://discord.gg/KgaQ36nVkh" target="_blank" rel="noopener" title="Rejoindre le Discord du Centre de généalogie">💬 Discord</a></div>
    `;
    return { controlsSlot: document.getElementById('pageControls') };
}
