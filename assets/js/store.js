// --- PERSISTANCE DU GEDCOM ENTRE LES PAGES (IndexedDB) ---
// Le fichier chargé sur index.html doit rester disponible sur les autres pages (arbre, cartes,
// qualité, décès manquants, recensements, parentés...) sans avoir à le recharger. sessionStorage
// plafonne à ~5 Mo en UTF-16 (un GEDCOM de plusieurs Mo peut ne pas y tenir) et est cloisonné par
// onglet ; IndexedDB n'a pas ces limites. On stocke le texte brut (pas l'objet parsé) et chaque
// page reparse à l'ouverture : le parser est une passe linéaire rapide, et ça évite tout problème
// de schéma d'objet obsolète en cache d'une version à l'autre de l'outil.
const DB_NAME = 'visugedcom';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const CURRENT_KEY = 'current';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            if(!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveGedcom(text, filename) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ text, filename, savedAt: Date.now() }, CURRENT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadGedcom() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(CURRENT_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function clearGedcom() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(CURRENT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
