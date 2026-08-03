// --- EXPORT HTML AUTONOME (page courante -> un seul fichier .html interactif, sans réimport) ---
// Empaquette la page actuelle en un fichier statique qui embarque : (1) le GEDCOM actuellement
// chargé (voir bootstrap.js pour la lecture, readEmbeddedGedcom), (2) tous les modules ES qu'elle
// importe (fusionnés en un seul <script> classique, puisqu'un fichier ouvert en file:// ne peut pas
// résoudre des imports relatifs), et (3) sa feuille de style externe (assets/css/app.css), pour que
// le fichier exporté reste lisible même isolé du reste du site.

const IMPORT_RE = /import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g;

function extractImportSpecifiers(source) {
    const specs = [];
    const re = /import\s*\{[^}]*\}\s*from\s*['"]([^'"]+)['"]\s*;?/g;
    let m;
    while((m = re.exec(source))) specs.push(m[1]);
    return specs;
}

function stripModuleSyntax(source) {
    return source
        .replace(IMPORT_RE, '')
        .replace(/^export\s+(?=(async\s+function\b|function\b|class\b|const\b|let\b|var\b))/gm, '');
}

async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok) throw new Error(`Impossible de charger ${url} (HTTP ${res.status})`);
    return res.text();
}

// Parcours en profondeur des imports : ordre post-fixe, donc chaque dépendance atterrit dans `order`
// avant tout ce qui l'importe (une classe/fonction ne doit être référencée, au premier appel réel à
// l'exécution, qu'après que sa propre déclaration ait déjà été exécutée plus haut dans le script).
// `visited` évite les doubles inclusions sur les dépendances partagées (ex: geo.js, importé à la fois
// par gedcom.js et maps.js).
async function collectModules(baseUrl, source, visited, order) {
    for(const spec of extractImportSpecifiers(source)) {
        const depUrl = new URL(spec, baseUrl).href;
        if(visited.has(depUrl)) continue;
        visited.add(depUrl);
        const depSource = await fetchText(depUrl);
        await collectModules(depUrl, depSource, visited, order);
        order.push(depSource);
    }
}

// Défense en profondeur : une séquence "</script" ou "<!--" perdue dans un commentaire/chaîne/regex
// du code empaqueté tronquerait le <script> à la réouverture du fichier exporté (le parseur HTML ne
// comprend pas la syntaxe JS, il cherche ces séquences en texte brut, où qu'elles apparaissent).
// Sans incidence sur le code : dans les deux cas la séquence corrigée reste strictement équivalente
// partout où elle peut légalement apparaître en JS (chaîne, commentaire, regex).
function escapeForInlineScript(code) {
    return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

async function inlineStylesheets(docClone) {
    const links = Array.from(docClone.querySelectorAll('link[rel="stylesheet"][href]'));
    for(const link of links) {
        const href = link.getAttribute('href');
        if(/^([a-z]+:)?\/\//i.test(href)) continue; // laisse les CDN externes tels quels
        try {
            const css = await fetchText(new URL(href, location.href).href);
            const styleEl = docClone.createElement('style');
            styleEl.textContent = css;
            link.replaceWith(styleEl);
        } catch(err) {
            console.error(`Feuille de style "${href}" non intégrée à l'export:`, err);
        }
    }
}

export async function exportStandaloneHtml(text, filename) {
    // Ré-export d'un export : plus aucun <script type="module"> (déjà aplati en #bundledAppScript
    // par un export précédent) — on réutilise ce bundle existant tel quel plutôt que d'échouer.
    const existingBundle = document.getElementById('bundledAppScript');
    const pageScriptEl = document.querySelector('script[type="module"]');
    let bundled;
    if(pageScriptEl) {
        const visited = new Set();
        const order = [];
        await collectModules(location.href, pageScriptEl.textContent, visited, order);
        bundled = order.map(stripModuleSyntax).join('\n\n')
            + '\n\n' + stripModuleSyntax(pageScriptEl.textContent);
    } else if(existingBundle) {
        bundled = existingBundle.textContent;
    } else {
        throw new Error('Aucun script de page à empaqueter.');
    }

    // On clone le document et on manipule le DOM du clone (au lieu de chercher/remplacer du texte
    // dans le HTML sérialisé) : cette page-ci contient forcément, en toutes lettres, les identifiants
    // qu'on cherche à repérer (embeddedGedcomData, bundledAppScript), donc un remplacement par texte
    // s'auto-matcherait sur ce code même et tronquerait tout le reste du script.
    const docClone = document.cloneNode(true);
    const oldEmbed = docClone.getElementById('embeddedGedcomData');
    if(oldEmbed) oldEmbed.remove(); // ré-export d'un export : retire l'ancien embed
    const oldBundle = docClone.getElementById('bundledAppScript');
    if(oldBundle) oldBundle.remove();
    docClone.querySelectorAll('script[type="module"]').forEach(el => el.remove());

    await inlineStylesheets(docClone);

    const embedEl = docClone.createElement('script');
    embedEl.id = 'embeddedGedcomData';
    embedEl.type = 'application/json';
    embedEl.textContent = JSON.stringify({ text, filename }).replace(/</g, '\\u003c');
    docClone.head.appendChild(embedEl);

    const bundleEl = docClone.createElement('script');
    bundleEl.id = 'bundledAppScript';
    bundleEl.textContent = escapeForInlineScript(bundled);
    docClone.body.appendChild(bundleEl);

    const html = '<!DOCTYPE html>\n' + docClone.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const base = (filename || 'export').replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_export.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Bouton "Exporter HTML" générique à poser dans le slot de contrôles d'une page (#pageControls).
// setData(text, filename) doit être appelé depuis le onData du bootstrap une fois le GEDCOM chargé
// (et avec des valeurs vides pour désactiver le bouton tant qu'aucun fichier n'est chargé).
export function setupExportButton(controlsSlot) {
    const btn = document.createElement('button');
    btn.id = 'exportHtmlBtn';
    btn.disabled = true;
    btn.title = "Exporter une copie HTML autonome avec les données intégrées (s'ouvre sans réimporter le fichier)";
    btn.textContent = '💾 Exporter HTML';
    controlsSlot.appendChild(btn);

    let currentText = null, currentFilename = null;
    btn.addEventListener('click', async () => {
        if(!currentText) return;
        const original = btn.textContent;
        btn.disabled = true; btn.textContent = '⏳ Export...';
        try {
            await exportStandaloneHtml(currentText, currentFilename);
        } catch(err) {
            console.error('Export HTML échoué:', err);
            alert("L'export a échoué : " + err.message);
        } finally {
            btn.disabled = false; btn.textContent = original;
        }
    });

    return {
        setData(text, filename) {
            currentText = text || null; currentFilename = filename || null;
            btn.disabled = !currentText;
        }
    };
}
