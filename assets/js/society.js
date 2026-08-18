// --- ANALYSE "SOCIÉTÉ" (professions, documentation, mobilité, prénoms, lignées) ---
// Complète les autres outils (Qualité, Visualisation) avec des angles absents ailleurs sur le site :
// transmission des professions, complétude documentaire, remariages, mobilité résidentielle et
// géographique, endogamie, naissances rapprochées dans une fratrie, traditions de prénoms et
// extinction potentielle des lignées masculines. Toutes les fonctions sont pures (list/map/fams en
// entrée, objets de résultats en sortie) : le rendu HTML/D3 reste dans visualisation.html (volet
// "Société" de la page "Vue d'ensemble").
//
// Limites liées au parser (assets/js/gedcom.js), assumées plutôt que masquées :
// - Pas de tag SOUR : "complétude documentaire" s'appuie donc sur les événements/faits renseignés,
//   pas sur des sources citées.
// - Les dates n'ont qu'une précision annuelle (getYear) : les "naissances la même année" ne sont
//   qu'un indice de naissance multiple possible, pas une confirmation jour/mois.
// DIV (divorce) et EMIG/IMMI (migrations) sont parsés par gedcom.js (voir f.div et i.events.EMIG/IMMI).

import { deptCode } from './geo.js';
import { estimatePopulation } from './communes-population.js';

function firstGivenName(p) {
    const g = p?.given || (p?.name || '').split(' ')[0];
    return g ? g.trim().split(' ')[0].toLowerCase() : '';
}

function childrenOf(person, fams, map) {
    const ids = new Set();
    (person.fams || []).forEach(fid => {
        const f = fams.get(fid);
        if (f) f.children.forEach(cid => ids.add(cid));
    });
    return Array.from(ids).map(cid => map.get(cid)).filter(Boolean);
}

// --- 1. Professions : classement + transmission père → fils ---
export function computeProfessionsStats(list, map) {
    const professions = new Map();
    let fatherSonEligible = 0, fatherSonMatches = 0;

    list.forEach(p => {
        (p.occupations || []).forEach(occ => {
            const key = (occ || '').trim();
            if (!key) return;
            professions.set(key, (professions.get(key) || 0) + 1);
        });

        if (p.sex === 'M' && p.occupations?.length && p.fatherId) {
            const father = map.get(p.fatherId);
            if (father?.occupations?.length) {
                fatherSonEligible++;
                const sonSet = new Set(p.occupations.map(o => o.trim().toLowerCase()));
                const fatherHasMatch = father.occupations.some(o => sonSet.has(o.trim().toLowerCase()));
                if (fatherHasMatch) fatherSonMatches++;
            }
        }
    });

    return {
        total: professions.size,
        top10: Array.from(professions.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10),
        fatherSonTransmission: {
            eligible: fatherSonEligible,
            matches: fatherSonMatches,
            rate: fatherSonEligible > 0 ? ((fatherSonMatches / fatherSonEligible) * 100).toFixed(1) : null
        }
    };
}

// --- 2. Complétude documentaire (à défaut de tag SOUR : dates + lieu + détail biographique) ---
export function computeDocumentationStats(list) {
    let sumScore = 0;
    const sparse = [];

    list.forEach(p => {
        const hasBirth = p.birth.year != null;
        const hasDeath = p.death.year != null;
        const hasPlace = !!(p.birth.geo?.city || p.death.geo?.city || p.marrGeo?.city);
        const hasExtra = (p.occupations?.length > 0) || (p.censusEvents?.length > 0) ||
            (p.resiEvents?.length > 0) || (p.otherEvents?.length > 0) ||
            p.events.BAPM.hasTag || p.events.BURI.hasTag;
        const score = (hasBirth ? 1 : 0) + (hasDeath ? 1 : 0) + (hasPlace ? 1 : 0) + (hasExtra ? 1 : 0);
        sumScore += score;

        if (score <= 1) {
            const missing = [];
            if (!hasBirth) missing.push('naissance');
            if (!hasDeath) missing.push('décès');
            if (!hasPlace) missing.push('lieu');
            if (!hasExtra) missing.push('détail biographique');
            sparse.push({ id: p.id, name: p.name, score, missing: missing.join(', ') });
        }
    });

    sparse.sort((a, b) => a.score - b.score);

    return {
        averageCompleteness: list.length ? ((sumScore / (list.length * 4)) * 100).toFixed(1) : 0,
        sparseCount: sparse.length,
        sparsest: sparse.slice(0, 20)
    };
}

// --- 3. Divorces (tag DIV) et remariages (plusieurs FAMS pour une même personne) ---
export function computeMaritalStabilityStats(list, fams) {
    let totalMarriages = 0, divorced = 0;
    const durations = [];

    fams.forEach(f => {
        if (!f.marr?.hasDate || f.marr.year == null) return;
        totalMarriages++;
        if (f.div?.hasDate && f.div.year != null) {
            divorced++;
            if (f.div.year > f.marr.year) durations.push(f.div.year - f.marr.year);
        }
    });

    const everMarried = list.filter(p => (p.fams || []).length > 0);
    const remarried = everMarried.filter(p => p.fams.length > 1);

    return {
        totalMarriages,
        divorced,
        divorceRate: totalMarriages > 0 ? ((divorced / totalMarriages) * 100).toFixed(1) : 0,
        averageDurationBeforeDivorce: durations.length ?
            (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : null,
        remarriage: {
            everMarriedCount: everMarried.length,
            remarriedCount: remarried.length,
            rate: everMarried.length > 0 ? ((remarried.length / everMarried.length) * 100).toFixed(1) : 0
        }
    };
}

// --- Migrations (tags EMIG/IMMI) ---
export function computeMigrationStats(list) {
    let emigrationCount = 0, immigrationCount = 0;
    const emigrationPlaces = new Map();
    const immigrationPlaces = new Map();

    list.forEach(p => {
        const emig = p.events.EMIG, immi = p.events.IMMI;
        if (emig?.hasTag) {
            emigrationCount++;
            const city = emig.geo?.city;
            if (city) emigrationPlaces.set(city, (emigrationPlaces.get(city) || 0) + 1);
        }
        if (immi?.hasTag) {
            immigrationCount++;
            const city = immi.geo?.city;
            if (city) immigrationPlaces.set(city, (immigrationPlaces.get(city) || 0) + 1);
        }
    });

    return {
        emigrationCount,
        immigrationCount,
        topEmigrationPlaces: Array.from(emigrationPlaces.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
        topImmigrationPlaces: Array.from(immigrationPlaces.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
    };
}

// --- 4. Mobilité résidentielle (tag RESI, déjà parsé mais jamais exploité ailleurs sur le site) ---
export function computeResidenceMobility(list) {
    const placeCounts = new Map();
    const perPersonCounts = [];

    list.forEach(p => {
        if (!p.resiEvents?.length) return;
        const places = new Set();
        p.resiEvents.forEach(r => {
            const city = r.geo?.city;
            if (city) {
                places.add(city);
                placeCounts.set(city, (placeCounts.get(city) || 0) + 1);
            }
        });
        if (places.size) perPersonCounts.push(places.size);
    });

    return {
        individualsWithResidenceData: perPersonCounts.length,
        averageResidencesPerPerson: perPersonCounts.length ?
            (perPersonCounts.reduce((a, b) => a + b, 0) / perPersonCounts.length).toFixed(1) : 0,
        topPlaces: Array.from(placeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
    };
}

// --- 5. Endogamie géographique (couple né dans la même ville) + mobilité parent → enfant ---
// communesPopIndex (optionnel, voir assets/js/communes-population.js) ajoute une comparaison de
// taille de commune (enfant vs parent) par-dessus la comparaison même-ville/département/région/pays
// déjà existante : utile pour repérer l'exode rural ou l'attraction des villes au fil des générations.
// Seuils de classement : ×1.25 ou plus = "plus grande", ×0.8 ou moins = "plus petite", entre les deux
// = taille comparable (évite de classer "plus grande/petite" un écart de quelques dizaines d'habitants
// qui ne reflète qu'une imprécision de recensement plutôt qu'un vrai changement de milieu).
const CITY_SIZE_BIGGER_RATIO = 1.25;
const CITY_SIZE_SMALLER_RATIO = 0.8;

export function computeGeographicMobility(map, fams, communesPopIndex) {
    let marriagesWithBothTowns = 0, sameTownMarriages = 0;

    fams.forEach(f => {
        if (!f.husb || !f.wife) return;
        const h = map.get(f.husb), w = map.get(f.wife);
        const hCity = h?.birth?.geo?.city, wCity = w?.birth?.geo?.city;
        if (hCity && wCity) {
            marriagesWithBothTowns++;
            if (hCity.trim().toLowerCase() === wCity.trim().toLowerCase()) sameTownMarriages++;
        }
    });

    const buckets = { sameTown: 0, sameDept: 0, sameRegion: 0, sameCountry: 0, different: 0 };
    let mobilityTotal = 0;

    const citySizeBuckets = { bigger: 0, smaller: 0, similar: 0 };
    const citySizeMoves = [];

    map.forEach(p => {
        const childGeo = p.birth?.geo;
        if (!childGeo?.city) return;
        const parent = p.fatherId ? map.get(p.fatherId) : (p.motherId ? map.get(p.motherId) : null);
        const parentGeo = parent?.birth?.geo;
        if (!parentGeo?.city) return;

        mobilityTotal++;
        const sameTown = childGeo.city.trim().toLowerCase() === parentGeo.city.trim().toLowerCase();
        if (sameTown) buckets.sameTown++;
        else if (childGeo.dept && parentGeo.dept && childGeo.dept === parentGeo.dept) buckets.sameDept++;
        else if (childGeo.region && parentGeo.region && childGeo.region === parentGeo.region) buckets.sameRegion++;
        else if (childGeo.country && parentGeo.country && childGeo.country === parentGeo.country) buckets.sameCountry++;
        else buckets.different++;

        if (!sameTown && communesPopIndex && p.birth.year != null && parent.birth?.year != null) {
            const childPop = estimatePopulation(communesPopIndex, childGeo.city, deptCode(childGeo.dept), p.birth.year);
            const parentPop = estimatePopulation(communesPopIndex, parentGeo.city, deptCode(parentGeo.dept), parent.birth.year);
            if (childPop != null && parentPop != null && parentPop > 0) {
                const ratio = childPop / parentPop;
                const bucket = ratio >= CITY_SIZE_BIGGER_RATIO ? 'bigger' : (ratio <= CITY_SIZE_SMALLER_RATIO ? 'smaller' : 'similar');
                citySizeBuckets[bucket]++;
                citySizeMoves.push({
                    name: p.name, childPlace: childGeo.city, childPop, childYear: p.birth.year,
                    parentName: parent.name, parentPlace: parentGeo.city, parentPop, parentYear: parent.birth.year,
                    ratio
                });
            }
        }
    });

    const citySizeTotal = citySizeBuckets.bigger + citySizeBuckets.smaller + citySizeBuckets.similar;
    // Tri par écart le plus marquant, dans un sens comme dans l'autre (ratio ou son inverse, le plus
    // grand des deux) : place aussi bien les plus fortes montées en ville que les plus forts exodes.
    citySizeMoves.sort((a, b) => Math.max(b.ratio, 1 / b.ratio) - Math.max(a.ratio, 1 / a.ratio));

    return {
        endogamy: {
            sampleSize: marriagesWithBothTowns,
            sameTownMarriages,
            rate: marriagesWithBothTowns > 0 ? ((sameTownMarriages / marriagesWithBothTowns) * 100).toFixed(1) : 0
        },
        parentChildMobility: { total: mobilityTotal, buckets },
        citySize: {
            total: citySizeTotal,
            buckets: citySizeBuckets,
            percentages: {
                bigger: citySizeTotal > 0 ? ((citySizeBuckets.bigger / citySizeTotal) * 100).toFixed(1) : 0,
                smaller: citySizeTotal > 0 ? ((citySizeBuckets.smaller / citySizeTotal) * 100).toFixed(1) : 0,
                similar: citySizeTotal > 0 ? ((citySizeBuckets.similar / citySizeTotal) * 100).toFixed(1) : 0
            },
            topMoves: citySizeMoves.slice(0, 10)
        }
    };
}

// --- 6. Naissances la même année dans une fratrie (indice de naissance multiple : précision annuelle
//    seulement, voir note en tête de fichier) ---
export function computeSameYearSiblings(map, fams) {
    const sets = [];

    fams.forEach(f => {
        const byYear = new Map();
        (f.children || []).forEach(cid => {
            const c = map.get(cid);
            if (!c || c.birth.year == null || c.birth.approx) return;
            if (!byYear.has(c.birth.year)) byYear.set(c.birth.year, []);
            byYear.get(c.birth.year).push(c);
        });
        byYear.forEach((children, year) => {
            if (children.length >= 2) {
                sets.push({
                    year,
                    count: children.length,
                    names: children.map(c => c.name),
                    father: f.husb ? (map.get(f.husb)?.name || 'Inconnu') : 'Inconnu',
                    mother: f.wife ? (map.get(f.wife)?.name || 'Inconnue') : 'Inconnue'
                });
            }
        });
    });

    sets.sort((a, b) => b.count - a.count);
    return { totalSets: sets.length, sets: sets.slice(0, 10) };
}

// --- 7. Traditions de transmission des prénoms (enfant nommé d'après un grand-parent de même sexe) ---
export function computeNamingPatterns(map) {
    let paternalGfEligible = 0, paternalGfMatches = 0;
    let maternalGmEligible = 0, maternalGmMatches = 0;
    let anyEligible = 0, anyMatches = 0;

    map.forEach(p => {
        const childName = firstGivenName(p);
        if (!childName) return;

        const father = p.fatherId ? map.get(p.fatherId) : null;
        const mother = p.motherId ? map.get(p.motherId) : null;
        const pgf = father?.fatherId ? map.get(father.fatherId) : null;
        const pgm = father?.motherId ? map.get(father.motherId) : null;
        const mgf = mother?.fatherId ? map.get(mother.fatherId) : null;
        const mgm = mother?.motherId ? map.get(mother.motherId) : null;

        if (p.sex === 'M' && pgf) {
            const n = firstGivenName(pgf);
            if (n) { paternalGfEligible++; if (n === childName) paternalGfMatches++; }
        }
        if (p.sex === 'F' && mgm) {
            const n = firstGivenName(mgm);
            if (n) { maternalGmEligible++; if (n === childName) maternalGmMatches++; }
        }

        const sameGenderGrandparents = [pgf, pgm, mgf, mgm].filter(gp => gp && gp.sex === p.sex);
        if (sameGenderGrandparents.length) {
            anyEligible++;
            if (sameGenderGrandparents.some(gp => firstGivenName(gp) === childName)) anyMatches++;
        }
    });

    const rate = (matches, eligible) => eligible > 0 ? ((matches / eligible) * 100).toFixed(1) : null;
    return {
        paternalGrandfather: { eligible: paternalGfEligible, matches: paternalGfMatches, rate: rate(paternalGfMatches, paternalGfEligible) },
        maternalGrandmother: { eligible: maternalGmEligible, matches: maternalGmMatches, rate: rate(maternalGmMatches, maternalGmEligible) },
        anySameGenderGrandparent: { eligible: anyEligible, matches: anyMatches, rate: rate(anyMatches, anyEligible) }
    };
}

// --- 8. Extinction potentielle des lignées masculines : hommes décédés, sans fils connu, alors que
//    la lignée a eu des enfants. Basé uniquement sur les données saisies (voir note dans visualisation.html).
export function computeSurnameExtinction(map, fams) {
    const bySurname = new Map();
    map.forEach(p => {
        if (p.sex !== 'M' || !p.surname) return;
        const key = p.surname.trim();
        if (!key) return;
        if (!bySurname.has(key)) bySurname.set(key, []);
        bySurname.get(key).push(p);
    });

    const atRisk = [];
    bySurname.forEach((men, surname) => {
        const menWithChildren = men.filter(m => childrenOf(m, fams, map).length > 0);
        const menWithSons = men.filter(m => childrenOf(m, fams, map).some(c => c.sex === 'M'));
        const menDeceasedWithoutSon = men.filter(m =>
            m.death?.year != null && !childrenOf(m, fams, map).some(c => c.sex === 'M')
        );

        if (men.length > 0 && menWithSons.length === 0 && menWithChildren.length > 0) {
            atRisk.push({
                surname,
                menRecorded: men.length,
                menWithChildren: menWithChildren.length,
                menDeceasedWithoutSon: menDeceasedWithoutSon.length
            });
        }
    });

    atRisk.sort((a, b) => b.menRecorded - a.menRecorded);
    return { totalMaleSurnames: bySurname.size, atRiskCount: atRisk.length, atRiskSurnames: atRisk.slice(0, 15) };
}

// --- 9. Saisonnalité des mariages par profession : le mois de mariage (tag MARR/DATE — jour+mois
//    disponible seulement pour une date complète et certaine, voir gedcom.js strictFullDate) croisé
//    avec les professions (p.occupations) des personnes qui se marient. Une même personne peut
//    apparaître dans plusieurs FAMS (remariage) : chaque mariage daté compte séparément pour elle.
//    minYear/maxYear (optionnels) restreignent l'analyse à une période, pour voir si un profil
//    saisonnier se déplace au fil du temps plutôt que de n'avoir qu'une moyenne sur tout le fichier.
export const SEASONALITY_MONTH_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const SEASONALITY_MONTH_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

export function computeMarriageSeasonality(list, fams, opts = {}) {
    const topN = opts.topN || 8;
    const minYear = opts.minYear ?? null;
    const maxYear = opts.maxYear ?? null;
    const minSample = opts.minSample || 5;

    const profTotals = new Map();
    const profMonths = new Map();
    const overallByMonth = new Array(12).fill(0);
    let overallTotal = 0;

    list.forEach(p => {
        if (!p.occupations?.length || !p.fams?.length) return;
        const profs = Array.from(new Set(p.occupations.map(o => o.trim()).filter(Boolean)));
        if (!profs.length) return;

        p.fams.forEach(fid => {
            const f = fams.get(fid);
            if (!f?.marr?.hasDate || f.marr.month == null) return;
            if (minYear != null && (f.marr.year == null || f.marr.year < minYear)) return;
            if (maxYear != null && (f.marr.year == null || f.marr.year > maxYear)) return;

            const month = f.marr.month;
            overallByMonth[month]++;
            overallTotal++;
            profs.forEach(prof => {
                if (!profMonths.has(prof)) { profMonths.set(prof, new Array(12).fill(0)); profTotals.set(prof, 0); }
                profMonths.get(prof)[month]++;
                profTotals.set(prof, profTotals.get(prof) + 1);
            });
        });
    });

    const toRow = (label, total, counts) => ({
        label, total,
        byMonth: counts.map((count, month) => ({
            month, label: SEASONALITY_MONTH_LABELS[month], shortLabel: SEASONALITY_MONTH_SHORT[month], count,
            pct: total > 0 ? +(count / total * 100).toFixed(1) : 0
        }))
    });

    const professions = Array.from(profTotals.entries())
        .filter(([, total]) => total >= minSample)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([prof, total]) => toRow(prof, total, profMonths.get(prof)));

    const overall = toRow('Ensemble', overallTotal, overallByMonth);

    // Repère le plus grand écart (profession, mois) par rapport à la moyenne générale de ce mois-là :
    // un exemple concret à mettre en avant sans imposer d'hypothèse a priori (hiver, été...).
    let mostSkewed = null, maxDelta = -1;
    professions.forEach(row => {
        row.byMonth.forEach((m, i) => {
            const delta = m.pct - overall.byMonth[i].pct;
            if (Math.abs(delta) > maxDelta) {
                maxDelta = Math.abs(delta);
                mostSkewed = { profession: row.label, month: SEASONALITY_MONTH_LABELS[i], profPct: m.pct, overallPct: overall.byMonth[i].pct, total: row.total };
            }
        });
    });

    return { monthLabels: SEASONALITY_MONTH_LABELS, overall, professions, overallTotal, mostSkewed, minSample };
}

export function computeSocietyStats(list, map, fams, communesPopIndex) {
    return {
        professions: computeProfessionsStats(list, map),
        documentation: computeDocumentationStats(list),
        maritalStability: computeMaritalStabilityStats(list, fams),
        migration: computeMigrationStats(list),
        residenceMobility: computeResidenceMobility(list),
        geographicMobility: computeGeographicMobility(map, fams, communesPopIndex),
        sameYearSiblings: computeSameYearSiblings(map, fams),
        namingPatterns: computeNamingPatterns(map),
        surnameExtinction: computeSurnameExtinction(map, fams)
    };
}

// --- Graphiques D3 (même idiome visuel que assets/js/maps.js / quality.js) ---

// Barres horizontales label/count, même idiome visuel que les autres graphiques du site (maps.js).
export function drawRankedBarChart(containerId, data, opts = {}) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();
    if (!data.length) {
        container.append('div').attr('class', 'map-placeholder').text(opts.emptyMessage || 'Aucune donnée disponible.');
        return;
    }

    const width = container.node().clientWidth || 500;
    const barHeight = 22;
    const margin = { top: 10, right: 44, bottom: 10, left: 150 };
    const height = margin.top + margin.bottom + data.length * barHeight;
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const maxCount = d3.max(data, d => d.count) || 1;
    const x = d3.scaleLinear().domain([0, maxCount]).nice().range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(data.map(d => d.label)).range([margin.top, height - margin.bottom]).padding(0.22);
    const color = opts.color || '#3498db';
    const colorHover = opts.colorHover || '#2980b9';

    const tooltip = document.getElementById('tooltip');
    svg.selectAll('rect.bar').data(data).join('rect')
        .attr('class', 'bar')
        .attr('x', x(0)).attr('y', d => y(d.label)).attr('width', d => x(d.count) - x(0)).attr('height', y.bandwidth())
        .attr('fill', color)
        .on('mouseover', function(e, d) {
            d3.select(this).attr('fill', colorHover);
            if (tooltip) {
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${d.label}</strong><div class="tt-row"><span>${opts.countLabel || 'Occurrences'}</span><span>${d.count}</span></div>`;
            }
        })
        .on('mousemove', e => {
            if (!tooltip) return;
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('fill', color);
            if (tooltip) tooltip.style.opacity = 0;
        });

    svg.selectAll('text.bar-label').data(data).join('text')
        .attr('class', 'bar-label')
        .attr('x', margin.left - 8).attr('y', d => y(d.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .attr('text-anchor', 'end').style('font-size', '11px')
        .text(d => d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label)
        .append('title').text(d => d.label);

    svg.selectAll('text.bar-count').data(data).join('text')
        .attr('class', 'bar-count')
        .attr('x', d => x(d.count) + 5).attr('y', d => y(d.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .style('font-size', '10px').style('fill', '#555')
        .text(d => d.count);
}

// Barres verticales par catégorie, identique dans l'esprit à drawIssuesBarChart (quality.js).
export function drawCategoryBarChart(containerId, data) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();
    if (!data.length || !data.some(d => d.count > 0)) {
        container.append('div').attr('class', 'map-placeholder').text('Aucune donnée disponible.');
        return;
    }

    const width = container.node().clientWidth || 400, height = 240;
    const margin = { top: 15, right: 15, bottom: 55, left: 40 };
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const x = d3.scaleBand().domain(data.map(d => d.label)).range([margin.left, width - margin.right]).padding(0.3);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count) || 1]).nice().range([height - margin.bottom, margin.top]);

    svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x))
        .selectAll('text').style('font-size', '9px').attr('transform', 'rotate(-20)').style('text-anchor', 'end');
    svg.append('g').attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('d')))
        .selectAll('text').style('font-size', '10px');

    svg.selectAll('rect.bar').data(data).join('rect').attr('class', 'bar')
        .attr('x', d => x(d.label)).attr('y', d => y(d.count))
        .attr('width', x.bandwidth()).attr('height', d => height - margin.bottom - y(d.count))
        .attr('fill', '#e67e22');

    svg.selectAll('text.val').data(data).join('text').attr('class', 'val')
        .attr('x', d => x(d.label) + x.bandwidth() / 2).attr('y', d => y(d.count) - 5)
        .attr('text-anchor', 'middle').style('font-size', '11px').style('font-weight', 'bold')
        .text(d => d.count);
}

// Heatmap profession × mois de mariage (voir computeMarriageSeasonality) : une ligne "Ensemble" (tous
// mariages datés confondus) sert de référence au-dessus des lignes par profession, triées par nombre
// de mariages décroissant. Chaque cellule encode, en dégradé séquentiel (une seule teinte, clair→foncé,
// même idiome que le fond de carte de maps.js), la part des mariages de CETTE ligne tombant dans ce
// mois (pourcentage, pas effectif brut) : ça permet de comparer la forme de la saisonnalité entre des
// professions dont les effectifs totaux diffèrent beaucoup. L'effectif brut reste visible au survol.
export function drawSeasonalityHeatmap(containerId, data, opts = {}) {
    const container = d3.select(`#${containerId}`);
    container.selectAll('*').remove();

    const rows = data.overall.total > 0 ? [data.overall, ...data.professions] : [];
    if (!rows.length) {
        container.append('div').attr('class', 'map-placeholder')
            .text(opts.emptyMessage || 'Pas assez de données (profession + date de mariage complète — jour, mois, année — requises).');
        return;
    }

    const width = container.node().clientWidth || 600;
    const cellHeight = 24;
    const margin = { top: 26, right: 90, bottom: 6, left: 170 };
    const height = margin.top + margin.bottom + rows.length * cellHeight;
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const months = d3.range(12);
    const x = d3.scaleBand().domain(months).range([margin.left, width - margin.right]).padding(0.08);
    const y = d3.scaleBand().domain(rows.map(r => r.label)).range([margin.top, height - margin.bottom]).padding(0.08);
    const maxPct = d3.max(rows, r => d3.max(r.byMonth, m => m.pct)) || 1;
    const color = d3.scaleSequential(d3.interpolateBlues).domain([0, maxPct]);

    svg.selectAll('text.month-label').data(months).join('text').attr('class', 'month-label')
        .attr('x', m => x(m) + x.bandwidth() / 2).attr('y', margin.top - 8)
        .attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#555')
        .text(m => SEASONALITY_MONTH_SHORT[m]);

    svg.selectAll('text.row-label').data(rows).join('text').attr('class', 'row-label')
        .attr('x', margin.left - 8).attr('y', r => y(r.label) + y.bandwidth() / 2).attr('dy', '0.35em')
        .attr('text-anchor', 'end').style('font-size', '11px')
        .style('font-weight', r => r.label === 'Ensemble' ? 700 : 400)
        .text(r => r.label.length > 24 ? r.label.slice(0, 22) + '…' : r.label)
        .append('title').text(r => r.label);

    // Séparateur sous la ligne "Ensemble" pour la distinguer visuellement des professions.
    svg.append('line')
        .attr('x1', margin.left - 4).attr('x2', width - margin.right)
        .attr('y1', y(rows[0].label) + y.bandwidth() + y.step() * 0.04)
        .attr('y2', y(rows[0].label) + y.bandwidth() + y.step() * 0.04)
        .attr('stroke', '#bbb').attr('stroke-width', 1);

    const tooltip = document.getElementById('tooltip');
    const rowGroups = svg.selectAll('g.seas-row').data(rows).join('g').attr('class', 'seas-row');
    rowGroups.selectAll('rect').data(r => r.byMonth.map(m => ({ ...m, rowLabel: r.label, rowTotal: r.total }))).join('rect')
        .attr('x', d => x(d.month)).attr('y', d => y(d.rowLabel))
        .attr('width', x.bandwidth()).attr('height', y.bandwidth())
        .attr('fill', d => d.count > 0 ? color(d.pct) : '#f4f6f7')
        .attr('stroke', '#fff').attr('stroke-width', 1)
        .on('mouseover', function(e, d) {
            d3.select(this).attr('stroke', '#2c3e50').attr('stroke-width', 1.5);
            if (tooltip) {
                tooltip.style.opacity = 1;
                tooltip.innerHTML = `<strong>${d.rowLabel} — ${d.label}</strong>
                    <div class="tt-row"><span>Mariages ce mois</span><span>${d.count}</span></div>
                    <div class="tt-row"><span>Part sur l'année</span><span>${d.pct}%</span></div>
                    <div class="tt-row"><span>Total « ${d.rowLabel} »</span><span>${d.rowTotal}</span></div>`;
            }
        })
        .on('mousemove', e => {
            if (!tooltip) return;
            tooltip.style.left = Math.min(e.pageX + 15, window.innerWidth - 320) + 'px';
            tooltip.style.top = Math.min(e.pageY + 15, window.innerHeight - 250) + 'px';
        })
        .on('mouseout', function() {
            d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1);
            if (tooltip) tooltip.style.opacity = 0;
        });

    // Légende séquentielle (dégradé + repères min/max) : requise pour une heatmap, où la couleur porte
    // l'information (contrairement aux barres/lignes du site, où l'axe suffit).
    const legendX = width - margin.right + 18, legendY = margin.top, legendW = 14, legendH = Math.min(90, height - margin.top - margin.bottom);
    const gradientId = `seas-grad-${containerId}`;
    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient').attr('id', gradientId).attr('x1', '0').attr('x2', '0').attr('y1', '1').attr('y2', '0');
    d3.range(0, 1.01, 0.1).forEach(t => gradient.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', color(t * maxPct)));
    svg.append('rect').attr('x', legendX).attr('y', legendY).attr('width', legendW).attr('height', legendH)
        .attr('fill', `url(#${gradientId})`).attr('stroke', '#ccc').attr('stroke-width', 0.5);
    svg.append('text').attr('x', legendX + legendW + 5).attr('y', legendY + 8).style('font-size', '9px').style('fill', '#555').text(`${maxPct.toFixed(0)}%`);
    svg.append('text').attr('x', legendX + legendW + 5).attr('y', legendY + legendH).style('font-size', '9px').style('fill', '#555').text('0%');
}
