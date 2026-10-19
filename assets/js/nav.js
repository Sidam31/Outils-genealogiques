// --- HEADER COMMUN (navigation entre les pages) ---
// visualisation.html, recherche.html et rue-commune.html regroupent chacune plusieurs anciens
// outils fusionnés en une seule page (bascule interne via .subnav-bar) : Visualisation+Société,
// Décès manquants+FranceArchives, et Rues de Paris+Communes de France+Rues de Toulouse. Voir
// onglets internes dans ces fichiers.
// Logo "Le Centre de généalogie" encodé en data URI (plutôt qu'un fichier assets/img/*.png) pour
// que l'export HTML autonome (export-html.js) reste un fichier unique, sans dépendance externe.
const CDG_LOGO = 'data:image/png;base64,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';

const TOOLS = [
    { href: 'arbre.html', icon: '🌳', label: 'Arbre éventail', page: 'arbre' },
    { href: 'frise.html', icon: '🕰️', label: 'Frise de vie', page: 'frise' },
    { href: 'reseau.html', icon: '🕸️', label: 'Réseau', page: 'reseau' },
    { href: 'visualisation.html', icon: '📊', label: "Vue d'ensemble", page: 'visualisation' },
    { href: 'qualite.html', icon: '🔍', label: 'Analyse Qualité', page: 'qualite' },
    { href: 'recherche.html', icon: '🧭', label: 'Aide à la recherche', page: 'deces' },
    { href: 'parentes.html', icon: '🧬', label: 'Parentés hyp.', page: 'parentes' },
    { href: 'rue-commune.html', icon: '📍', label: 'Rue & Commune', page: 'rue-commune' },
];

// Monte le <header> commun dans #appHeader et renvoie un slot #pageControls que chaque page
// remplit avec ses propres contrôles (ex: recherche + profondeur pour l'Arbre éventail).
export function renderHeader(activePage) {
    const header = document.getElementById('appHeader');
    if(!header) return { controlsSlot: null };
    // Un export HTML autonome (voir export-html.js) est un instantané figé d'un fichier précis :
    // "Changer de fichier" y renverrait vers un index.html sans données, ce qui n'a pas de sens ici.
    const isLockedExport = !!document.getElementById('embeddedGedcomData');
    const creditLinks = `<a href="https://www.lecentredegenealogie.fr/" target="_blank" rel="noopener" title="Le Centre de généalogie — site"><img src="${CDG_LOGO}" alt="" class="cdg-logo">Le Centre de généalogie</a> · <a href="https://discord.gg/KgaQ36nVkh" target="_blank" rel="noopener" title="Rejoindre le Discord du Centre de généalogie">💬 Discord</a> · <a href="mentions-legales.html" title="Licence du code et conditions générales d'utilisation">Mentions légales</a>`;
    const changeFileLink = isLockedExport ? '' : '<a class="tab-btn" href="index.html" title="Charger un autre fichier GEDCOM">📁 Changer de fichier</a>';
    header.innerHTML = `
        <h1>🔎 VisuGedcom</h1>
        <button class="side-toggle hidden" id="sideToggle" type="button" aria-controls="sidePanel" aria-expanded="false" title="Afficher/masquer le panneau d'options">⚙️ Options</button>
        <button class="nav-burger" id="navBurger" type="button" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="mainNav">☰</button>
        <nav class="tabs" id="mainNav">
            ${TOOLS.map(t => `<a class="tab-btn${t.page === activePage ? ' active' : ''}" href="${t.href}">${t.icon} ${t.label}</a>`).join('')}
            <div class="nav-extra">${changeFileLink}<div class="app-credit">${creditLinks}</div></div>
        </nav>
        ${isLockedExport ? '' : `<div class="ctrl header-extra" id="changeFileCtrl">${changeFileLink}</div>`}
        <div class="ctrl app-credit header-extra">${creditLinks}</div>
    `;

    // Panneau latéral repliable : accueille les contrôles propres à la page (#pageControls).
    // Il n'est affiché (et son bouton visible) que si la page y a effectivement posé du contenu,
    // voir initSidePanel() appelé par bootstrap() après onReady.
    const side = document.createElement('aside');
    side.id = 'sidePanel';
    side.className = 'side-panel';
    side.innerHTML = '<div class="side-panel-head">Options</div><div class="side-controls" id="pageControls"></div>';
    header.insertAdjacentElement('afterend', side);

    // Menu burger : s'active dès que l'en-tête ne tient plus sur une seule ligne (mesuré, pas
    // basé sur une largeur fixe), le nav complet démarre toujours fermé.
    const burger = document.getElementById('navBurger');
    const mainNav = document.getElementById('mainNav');
    const closeNav = () => { mainNav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); burger.textContent = '☰'; };
    burger.addEventListener('click', () => {
        const open = mainNav.classList.toggle('open');
        burger.setAttribute('aria-expanded', String(open));
        burger.textContent = open ? '✕' : '☰';
    });
    mainNav.addEventListener('click', e => { if(e.target.closest('a')) closeNav(); });
    document.addEventListener('click', e => { if(!header.contains(e.target)) closeNav(); });

    const fitHeader = () => {
        header.classList.remove('compact');
        closeNav();
        const kids = Array.from(header.children).filter(el => el.offsetParent !== null);
        // Comparaison des centres verticaux (align-items:center décale les tops d'éléments de
        // hauteurs différentes même sur une seule ligne) : un vrai retour à la ligne décale d'une
        // hauteur de ligne entière.
        const mid = el => el.offsetTop + el.offsetHeight / 2;
        const m0 = mid(kids[0]);
        if(kids.some(el => Math.abs(mid(el) - m0) > 12) || header.scrollWidth > header.clientWidth) header.classList.add('compact');
        document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
    };
    fitHeader();
    window.addEventListener('resize', fitHeader);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeader);

    return { controlsSlot: document.getElementById('pageControls') };
}


// À appeler une fois les contrôles de la page posés dans #pageControls : affiche le bouton
// "Options" et gère l'ouverture du panneau (ouvert par défaut sur grand écran si openByDefault).
export function initSidePanel({ openByDefault = false } = {}) {
    const side = document.getElementById('sidePanel');
    const toggle = document.getElementById('sideToggle');
    const slot = document.getElementById('pageControls');
    if(!side || !toggle || !slot) return;
    if(!slot.children.length) { side.remove(); return; }
    toggle.classList.remove('hidden');
    let stored = null;
    try { stored = localStorage.getItem('sidePanelOpen'); } catch(e) {}
    const wide = window.innerWidth > 900;
    const set = open => {
        document.body.classList.toggle('side-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        try { localStorage.setItem('sidePanelOpen', open ? '1' : '0'); } catch(e) {}
        // Les graphiques se recalent sur leur conteneur au "resize"
        setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
    };
    toggle.addEventListener('click', e => { e.stopPropagation(); set(!document.body.classList.contains('side-open')); });
    const initial = stored !== null ? stored === '1' && wide : openByDefault && wide;
    document.body.classList.toggle('side-open', initial);
    toggle.setAttribute('aria-expanded', String(initial));
}
