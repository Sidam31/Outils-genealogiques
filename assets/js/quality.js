import { getEventLabel } from './utils.js';

// --- QUALITY ANALYSIS (charts + report, ported from seraphin_studio.html) ---
// scopeSet : Set d'IDs à analyser (null = tout le fichier). sosaMap : Map id -> numéro Sosa
// (null si pas de racine choisie) ; quand fourni, chaque problème porte son numéro Sosa et la
// liste est triée par Sosa croissant plutôt que par ordre de rencontre dans le fichier.
export function computeQualityIssues(list, fams, scopeSet, sosaMap, opts, minAgeDeat, minAgeMarr, maxYearBapm, maxYearBuri) {
    const issues = [];
    const currentYear = new Date().getFullYear();

    list.forEach(p => {
        if (scopeSet && !scopeSet.has(p.id)) return;
        const sosa = sosaMap ? (sosaMap.get(p.id) ?? null) : null;

        ['BIRT', 'DEAT', 'BURI', 'BAPM'].forEach(evtType => {
            if (!opts[evtType]) return;
            const evtData = p.events[evtType];
            const isMissing = !evtData.hasTag;
            const isEmpty = evtData.hasTag && !evtData.hasDate;
            if (!isMissing && !isEmpty) return;

            let shouldReport = true;
            if (evtType === 'DEAT' && p.birth.year != null) {
                const age = currentYear - p.birth.year;
                if (age < minAgeDeat) shouldReport = false;
            }
            if (evtType === 'BAPM' && maxYearBapm != null && p.birth.year != null && p.birth.year > maxYearBapm) shouldReport = false;
            if (evtType === 'BURI' && maxYearBuri != null && p.birth.year != null && p.birth.year > maxYearBuri) shouldReport = false;
            if (shouldReport) {
                issues.push({ id: p.id, name: p.name, birthYear: p.birth.year, birthApprox: p.birth.approx, type: evtType, issue: isMissing ? "Événement manquant" : "Date manquante", sosa });
            }
        });

        if (opts.MARR && p.fams.length > 0) {
            let shouldReportMarr = true;
            if (p.birth.year != null) {
                const age = currentYear - p.birth.year;
                if (age < minAgeMarr) shouldReportMarr = false;
            }
            if (shouldReportMarr) {
                let hasMissingMarr = false, hasEmptyDateMarr = false;
                p.fams.forEach(famId => {
                    const fam = fams.get(famId);
                    if (fam) {
                        if (!fam.marr.hasTag) hasMissingMarr = true;
                        else if (!fam.marr.hasDate) hasEmptyDateMarr = true;
                    }
                });
                if (hasMissingMarr) issues.push({ id: p.id, name: p.name, birthYear: p.birth.year, birthApprox: p.birth.approx, type: 'MARR', issue: "Événement manquant (Famille)", sosa });
                else if (hasEmptyDateMarr) issues.push({ id: p.id, name: p.name, birthYear: p.birth.year, birthApprox: p.birth.approx, type: 'MARR', issue: "Date manquante (Famille)", sosa });
            }
        }
    });
    if (sosaMap) issues.sort((a, b) => (a.sosa ?? Infinity) - (b.sosa ?? Infinity));
    return issues;
}

export function drawIssuesBarChart(issues) {
    const evtColors = { BIRT:'#3498db', DEAT:'#34495e', MARR:'#9b59b6', BURI:'#7f8c8d', BAPM:'#16a085' };
    const counts = {};
    issues.forEach(i => { counts[i.type] = (counts[i.type]||0)+1; });
    const data = Object.entries(counts).map(([type,count]) => ({type,count})).sort((a,b) => b.count - a.count);

    const container = d3.select('#qualityBarChart');
    container.selectAll('*').remove();
    const width = container.node().clientWidth || 400, height = 220;
    const margin = {top:15, right:15, bottom:35, left:35};
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const x = d3.scaleBand().domain(data.map(d=>d.type)).range([margin.left, width-margin.right]).padding(0.3);
    const y = d3.scaleLinear().domain([0, d3.max(data, d=>d.count) || 1]).nice().range([height-margin.bottom, margin.top]);

    svg.append('g').attr('transform', `translate(0,${height-margin.bottom})`)
        .call(d3.axisBottom(x).tickFormat(t => getEventLabel(t)))
        .selectAll('text').style('font-size', '10px');
    svg.append('g').attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('d')))
        .selectAll('text').style('font-size', '10px');

    svg.selectAll('rect.bar').data(data).join('rect').attr('class','bar')
        .attr('x', d=>x(d.type)).attr('y', d=>y(d.count))
        .attr('width', x.bandwidth()).attr('height', d=>height-margin.bottom-y(d.count))
        .attr('fill', d=>evtColors[d.type] || '#999');

    svg.selectAll('text.val').data(data).join('text').attr('class','val')
        .attr('x', d=>x(d.type)+x.bandwidth()/2).attr('y', d=>y(d.count)-5)
        .attr('text-anchor','middle').style('font-size','11px').style('font-weight','bold')
        .text(d=>d.count);
}

export function drawIssuesTimeline(issues) {
    const container = d3.select('#qualityTimelineChart');
    container.selectAll('*').remove();
    const withYear = issues.filter(i => i.birthYear);
    if (!withYear.length) {
        container.append('div').style('color', '#999').style('padding', '20px 10px').style('text-align', 'center').style('font-size', '0.85em')
            .text("Aucune année de naissance disponible pour ces problèmes.");
        return;
    }

    const decadeOf = y => Math.floor(y/10)*10;
    const counts = new Map();
    withYear.forEach(i => { const dec = decadeOf(i.birthYear); counts.set(dec, (counts.get(dec)||0)+1); });
    const decades = Array.from(counts.keys()).sort((a,b)=>a-b);
    const data = decades.map(d => ({decade:d, count:counts.get(d)}));

    const width = container.node().clientWidth || 400, height = 220;
    const margin = {top:15, right:15, bottom:35, left:35};
    const svg = container.append('svg').attr('width', width).attr('height', height);

    const x = d3.scaleBand().domain(decades).range([margin.left, width-margin.right]).padding(0.2);
    const y = d3.scaleLinear().domain([0, d3.max(data, d=>d.count) || 1]).nice().range([height-margin.bottom, margin.top]);
    const tickStep = Math.ceil(decades.length / 10) || 1;

    svg.append('g').attr('transform', `translate(0,${height-margin.bottom})`)
        .call(d3.axisBottom(x).tickValues(decades.filter((d,i)=> i % tickStep === 0)).tickFormat(d => `${d}s`))
        .selectAll('text').style('font-size', '9px');
    svg.append('g').attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('d')))
        .selectAll('text').style('font-size', '10px');

    svg.selectAll('rect.bar').data(data).join('rect').attr('class','bar')
        .attr('x', d=>x(d.decade)).attr('y', d=>y(d.count))
        .attr('width', x.bandwidth()).attr('height', d=>height-margin.bottom-y(d.count))
        .attr('fill', '#e67e22');
}
