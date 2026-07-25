// --- INFÉRENCE (utilisé par l'outil "Décès manquants") ---
// Estime une année de naissance quand elle n'est pas actée, par ordre de fiabilité décroissante.
// Renvoie { year, source, estimated } ou null si aucune donnée exploitable.
export function estimateBirthYear(p, map, fams) {
    if (p.birth.year != null) return { year: p.birth.year, source: 'Acte de naissance', estimated: false };
    if (p.events?.BAPM?.year != null) return { year: p.events.BAPM.year, source: 'Baptême', estimated: true };
    if (p.marrYear != null) return { year: p.marrYear - 25, source: 'Mariage − 25 ans', estimated: true };
    if (p.childrenYears && p.childrenYears.length) return { year: p.childrenYears[0] - 27, source: '1er enfant − 27 ans', estimated: true };

    if (p.famc && fams.get(p.famc)) {
        const fam = fams.get(p.famc);
        const sibYears = (fam.children || [])
            .filter(id => id !== p.id)
            .map(id => map.get(id)?.birth?.year)
            .filter(y => y != null)
            .sort((a, b) => a - b);
        if (sibYears.length) {
            const mid = sibYears[Math.floor(sibYears.length / 2)];
            return { year: mid, source: 'Médiane des frères et sœurs', estimated: true };
        }
    }

    const father = p.fatherId ? map.get(p.fatherId) : null;
    if (father?.birth?.year != null) return { year: father.birth.year + 30, source: 'Naissance du père + 30 ans', estimated: true };
    const mother = p.motherId ? map.get(p.motherId) : null;
    if (mother?.birth?.year != null) return { year: mother.birth.year + 30, source: 'Naissance de la mère + 30 ans', estimated: true };

    for (const famId of p.fams || []) {
        const fam = fams.get(famId);
        if (!fam) continue;
        const spouseId = fam.husb === p.id ? fam.wife : (fam.wife === p.id ? fam.husb : null);
        const spouse = spouseId ? map.get(spouseId) : null;
        if (spouse?.birth?.year != null) return { year: spouse.birth.year, source: 'Naissance du conjoint (même génération)', estimated: true };
    }

    return null;
}

// Dernière année où l'on a une preuve directe que la personne était vivante : ses propres
// événements (naissance, baptême, recensement, résidence), ses mariages, la naissance de ses enfants.
export function lastKnownAliveYear(p, fams) {
    const years = [];
    if (p.birth.year != null) years.push(p.birth.year);
    ['BAPM', 'CENS', 'RESI'].forEach(k => { const y = p.events?.[k]?.year; if (y != null) years.push(y); });
    (p.fams || []).forEach(famId => {
        const fam = fams.get(famId);
        if (fam?.marr?.year != null) years.push(fam.marr.year);
    });
    if (p.childrenYears && p.childrenYears.length) years.push(p.childrenYears[p.childrenYears.length - 1]);
    return years.length ? Math.max(...years) : null;
}
