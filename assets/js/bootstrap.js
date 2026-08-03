// --- ORCHESTRATION COMMUNE À CHAQUE PAGE OUTIL ---
// Monte le header, relit le GEDCOM stocké par index.html (IndexedDB, voir store.js), le reparse,
// et transmet {list, map, fams, filename, controlsSlot} à la page. Si aucun fichier n'a encore été
// chargé, list/map/fams sont vides — chaque page affiche alors son propre message d'invitation à
// charger un fichier (déjà présent dans son HTML, ex. #chartMessage pour l'Arbre éventail).
import { renderHeader } from './nav.js';
import { loadGedcom } from './store.js';
import { GedcomParser } from './gedcom.js';
import { wireCopyButtons } from './utils.js';

// Une page ouverte via "Exporter HTML" (voir export-html.js) embarque son GEDCOM dans ce tag plutôt
// que de dépendre d'IndexedDB (absent/vide si le fichier est ouvert seul, hors du site). Quand il est
// présent, il a toujours priorité sur IndexedDB : c'est un instantané figé d'un fichier précis.
function readEmbeddedGedcom() {
    const tag = document.getElementById('embeddedGedcomData');
    if(!tag) return null;
    try {
        const payload = JSON.parse(tag.textContent);
        return (payload && payload.text) ? payload : null;
    } catch(err) {
        console.error('Lecture des données GEDCOM intégrées échouée:', err);
        return null;
    }
}

export async function bootstrap({ page, onReady, onData }) {
    const { controlsSlot } = renderHeader(page);
    wireCopyButtons();
    // Certaines pages (Arbre éventail) doivent poser leurs propres contrôles dans #pageControls
    // AVANT que les données n'arrivent (le rendu initial les lit immédiatement) : onReady est donc
    // appelé de façon synchrone, avant la lecture (asynchrone) du GEDCOM stocké.
    if(onReady) onReady(controlsSlot);

    let list = [], map = new Map(), fams = new Map(), filename = null, text = null;
    try {
        const stored = readEmbeddedGedcom() || await loadGedcom();
        if(stored && stored.text) {
            const parser = new GedcomParser();
            list = parser.parse(stored.text);
            map = new Map(list.map(i => [i.id, i]));
            fams = parser.fams;
            filename = stored.filename || null;
            text = stored.text;
        }
    } catch(err) {
        console.error('Lecture du GEDCOM stocké échouée:', err);
    }

    const data = { list, map, fams, filename, text, controlsSlot };
    if(onData) onData(data);
    return data;
}
