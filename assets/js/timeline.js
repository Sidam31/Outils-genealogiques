// --- FRISE DE VIE : assemblage des événements d'une personne + calculs de mise en page (pur, sans DOM/D3) ---
import { getEventLabel } from './utils.js';
import { estimateBirthYear } from './inference.js';

// Libellé d'un fait personnalisé (EVEN/FACT générique, ou tag standard type ADOP/GRAD/TITL...) :
// - tagLabel (ex. "Diplôme", posé par gedcom.js pour un tag standard reconnu) + typeLabel (le texte
//   libre d'un éventuel "2 TYPE", ex. "Master of Arts" — une combinaison standard GEDCOM, pas un usage
//   non conforme, y compris sous un tag qui n'est normalement pas générique comme "1 GRAD") se
//   combinent en "Diplôme : Master of Arts" plutôt que de se marcher dessus.
// - à défaut de tagLabel (cas EVEN/FACT générique, sans tag standard reconnu), typeLabel prime seul
//   (c'est généralement lui qui porte la description saisie par le généalogiste, ex. "Domicile",
//   "Condamnation", "Service militaire"), la valeur brute de la ligne "1 EVEN"/"1 FACT" venant en
//   complément si elle apporte une info distincte.
export function labelForOther(entry) {
    if (entry.tagLabel && entry.typeLabel && entry.typeLabel !== entry.tagLabel) return `${entry.tagLabel} : ${entry.typeLabel}`;
    if (entry.typeLabel && entry.value && entry.value !== entry.typeLabel) return `${entry.typeLabel} : ${entry.value}`;
    return entry.tagLabel || entry.typeLabel || entry.value || 'Événement';
}

function spouseName(fam, personId, map) {
    if (!fam) return null;
    const spouseId = fam.husb === personId ? fam.wife : (fam.wife === personId ? fam.husb : null);
    if (!spouseId) return null;
    return map.get(spouseId)?.name || null;
}

// BIRT toujours en premier, DEAT toujours en dernier (même année qu'un autre événement) ; le reste
// départagé alphabétiquement pour un ordre stable et reproductible.
function sourceRank(source) {
    if (source === 'BIRT') return -1;
    if (source === 'DEAT') return 1;
    return 0;
}

// Assemble tous les événements datés d'une personne (naissance/décès, mariages, recensements,
// domiciles, faits personnalisés) en une liste triée chronologiquement, prête pour la frise de vie.
// Les événements sans année exploitable sont renvoyés séparément (undated) plutôt qu'ignorés.
export function buildLifeEvents(person, map, fams) {
    const events = [];
    const undated = [];
    const birthYear = person.birth?.year ?? null;
    const deathYear = person.death?.year ?? null;
    // Naissance actée si connue, sinon estimée (baptême, mariage-25 ans, cadette/aîné de la fratrie...)
    // — sert à afficher un âge sur les événements AUTRES que la naissance elle-même, même quand la
    // date de naissance exacte n'est pas actée dans le GEDCOM (voir inference.js pour l'ordre de
    // priorité des indices utilisés).
    const birthEst = estimateBirthYear(person, map, fams);

    const add = (source, label, year, approx, geo, raw) => {
        if (year == null) { undated.push({ source, label, raw: raw ?? null }); return; }
        let age = null, ageEstimated = false;
        if (source === 'BIRT') {
            age = 0;
        } else if (birthEst) {
            age = year - birthEst.year;
            ageEstimated = birthEst.estimated;
        }
        events.push({
            source, label, year, approx: !!approx,
            age, ageEstimated,
            geo: geo || null, raw: raw ?? null
        });
    };

    ['BIRT', 'DEAT', 'BAPM', 'BURI'].forEach(code => {
        const e = person.events?.[code];
        if (!e || !e.hasTag) return;
        add(code, getEventLabel(code), e.year, e.approx, e.geo, null);
    });

    (person.fams || []).forEach(famId => {
        const fam = fams.get(famId);
        if (!fam || !fam.marr?.hasTag) return;
        const spouse = spouseName(fam, person.id, map);
        add('MARR', spouse ? `Mariage avec ${spouse}` : 'Mariage', fam.marr.year, false, fam.marr.geo, null);
    });

    (person.censusEvents || []).forEach(entry => add('CENS', 'Recensement', entry.year, entry.approx, entry.geo, null));
    (person.resiEvents || []).forEach(entry => add('RESI', 'Résidence', entry.year, entry.approx, entry.geo, null));

    // Les EVEN/FACT reconnus comme recensement (isCens) ou résidence (isResi) sont déjà représentés
    // ci-dessus via censusEvents/resiEvents : les reprendre ici les afficherait en double sur la frise.
    (person.otherEvents || []).forEach(entry => {
        if (entry.isCens || entry.isResi) return;
        add('OTHER', labelForOther(entry), entry.year, entry.approx, entry.geo, entry.value);
    });

    events.sort((a, b) => (a.year - b.year) || (sourceRank(a.source) - sourceRank(b.source)) || a.label.localeCompare(b.label, 'fr'));
    events.forEach((e, idx) => { e.key = `${e.source}-${e.year}-${idx}`; });

    return { personId: person.id, personName: person.name, birthYear, deathYear, events, undated };
}

// Estimation de la largeur d'un texte sans passer par une mesure DOM (mise en page purement calculée
// avant tout rendu SVG) : heuristique au nombre de caractères, calibrée pour une police sans-serif
// classique (Segoe UI/Arial) — suffisante pour décider d'un retournement/troncature de libellé.
export function estimateTextWidth(text, fontSizePx = 11) {
    return (text ? text.length : 0) * fontSizePx * 0.55 + 8;
}

// Calcule la hauteur de "tige" de chaque événement pour l'effet cascade/escalier de la frise :
// événements déjà triés chronologiquement, le plus ancien reçoit la tige la plus haute, le plus
// récent la plus courte (juste au-dessus de l'axe). Deux tiges de rangs adjacents diffèrent toujours
// exactement de `step` : tant que step >= hauteur d'une ligne de texte, deux libellés ne peuvent
// jamais se chevaucher verticalement, quel que soit leur nombre (step se resserre vers minStep et le
// SVG s'agrandit en hauteur plutôt que de laisser les libellés se superposer).
export function computeWaterfallLayout(events, { minStep = 16, maxStep = 34, maxTotal = 260 } = {}) {
    const n = events.length;
    if (!n) return [];
    const step = Math.min(maxStep, Math.max(minStep, maxTotal / n));
    return events.map((e, rank) => ({ ...e, rank, stemHeight: minStep + (n - 1 - rank) * step }));
}

// Fenêtre du contexte historique à afficher pour une personne donnée : de sa naissance (-2 ans) à son
// décès (+2 ans), ou à l'année courante si la personne n'a pas de décès acté (probablement vivante).
export function getHistoricalWindow(historicalTimeline, birthYear, deathYear) {
    const nowYear = new Date().getFullYear();
    const lifeEnd = deathYear != null ? deathYear : nowYear;
    const from = (birthYear != null ? birthYear : lifeEnd) - 2;
    const to = lifeEnd + 2;
    return historicalTimeline
        .map(h => ({ ...h, end: h.end == null ? Math.min(nowYear, to) : h.end }))
        .filter(h => h.end >= from && h.start <= to)
        .map(h => ({ ...h, start: Math.max(h.start, from), end: Math.max(h.start, Math.min(h.end, to)) }));
}

// Répartit des intervalles (bandeaux de contexte historique) sur le minimum de "voies" empilées sans
// chevauchement de libellé : algorithme glouton classique (tri par début, placement dans la première
// voie libre), optimal en nombre de voies. `effRight` (fin de barre OU fin de libellé, la plus grande
// des deux) évite qu'un régime très court (ex. "Jean Casimir-Perier", ~1 an) fasse chevaucher son
// libellé, plus large que sa barre, avec l'élément suivant de la même voie.
export function packHistoricalLanes(intervals, xScale, { minGapPx = 6, fontSizePx = 10 } = {}) {
    const items = intervals
        .map(iv => ({ ...iv, x1: xScale(iv.start), x2: xScale(iv.end) }))
        .sort((a, b) => a.x1 - b.x1);
    const laneEndX = [];
    for (const item of items) {
        const effRight = Math.max(item.x2, item.x1 + estimateTextWidth(item.label, fontSizePx));
        let lane = laneEndX.findIndex(endX => item.x1 >= endX + minGapPx);
        if (lane === -1) { lane = laneEndX.length; laneEndX.push(-Infinity); }
        item.lane = lane;
        laneEndX[lane] = effRight;
    }
    return { items, laneCount: laneEndX.length };
}
