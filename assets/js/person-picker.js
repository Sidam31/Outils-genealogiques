// --- WIDGET DE RECHERCHE DE PERSONNE ("ascendants de : [recherche]") ---
// Factorise le trio input+liste+label répété (recherche Arbre, filtre Cartes, filtre Qualité,
// individu de référence Parentés hypothétiques, filtres Décès manquants / Recensements) : chaque
// appelant fournit ses éléments DOM et la fonction appelée à la sélection.
export function createPersonPicker({ searchEl, resultsEl, selectedEl, getList, onSelect, formatLabel }) {
    searchEl.addEventListener('input', e => {
        const v = e.target.value.toLowerCase();
        resultsEl.innerHTML = '';
        if(v.length < 2) { resultsEl.style.display = 'none'; return; }
        const list = getList();
        const matches = list.filter(p => p.name.toLowerCase().includes(v)).slice(0, 10);
        if(matches.length) {
            resultsEl.style.display = 'block';
            matches.forEach(p => {
                const li = document.createElement('li');
                li.innerText = formatLabel ? formatLabel(p) : `${p.name} (${p.birth?.year || '?'})`;
                li.onclick = () => {
                    resultsEl.style.display = 'none';
                    searchEl.value = '';
                    if(selectedEl) selectedEl.textContent = `→ ${p.name}`;
                    onSelect(p);
                };
                resultsEl.appendChild(li);
            });
        }
    });
    return {
        reset() {
            if(selectedEl) selectedEl.textContent = '';
            searchEl.value = '';
            resultsEl.style.display = 'none';
        }
    };
}

// Ferme toutes les listes de résultats ouvertes au clic ailleurs que dans un ".ctrl" (même
// comportement que l'ancien onglet unique, appliqué page par page).
export function wireClickAway(...resultsEls) {
    document.addEventListener('click', e => {
        if(!e.target.closest('.ctrl')) resultsEls.forEach(el => { if(el) el.style.display = 'none'; });
    });
}
