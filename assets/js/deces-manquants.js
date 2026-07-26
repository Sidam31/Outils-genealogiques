import { estimateBirthYear, lastKnownAliveYear } from './inference.js';

// Année de première couverture du fichier des décès INSEE utilisé par matchID (voir
// https://deces.matchid.io) : une personne dont on est sûr qu'elle est morte avant cette date ne
// peut de toute façon pas y figurer.
export const INSEE_COVERAGE_START = 1970;

export const CATEGORY_LABELS = {
    death_missing: 'Décès manquant',
    death_incomplete: 'Décès incomplet',
    birth_incomplete: 'Naissance incomplète'
};

function guessSurname(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}
function guessGiven(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
}

// Un événement est "complet" s'il a un tag, une date ET un lieu : c'est le seuil au-delà duquel il
// n'y a plus rien d'utile à demander à matchID sur cet événement précis.
function isEventComplete(evt) {
    return !!(evt && evt.hasTag && evt.hasDate && evt.geo);
}
// Décrit ce qui manque sur un événement, pour affichage (ex. "date manquante, lieu manquant").
function missingParts(evt) {
    if (!evt || !evt.hasTag) return ['événement absent'];
    const parts = [];
    if (!evt.hasDate) parts.push('date manquante');
    if (!evt.geo) parts.push('lieu manquant');
    return parts;
}

// Score/justifie la confiance qu'une personne de la liste soit réellement une piste utile à
// interroger sur matchID. Les motifs affichés permettent au généalogiste de juger la piste
// lui-même plutôt que de faire confiance aveuglément au badge.
function computeConfidence(p, birthEst, lastAlive, opts, currentYear, category) {
    const reasons = [];
    let score = 0;
    const deat = p.events.DEAT;

    if (category === 'birth_incomplete') {
        // Le décès est déjà acté (date + lieu) ET dans le périmètre INSEE : la piste est certaine,
        // seule la naissance manque — matchID peut la compléter à partir du décès déjà identifié.
        score = 2;
        reasons.push(`Décès acté en ${deat.year} (${deat.geo?.city || deat.geo?.dept || ''}) : dans le périmètre INSEE`);
        reasons.push(`Naissance incomplète : ${missingParts(p.events.BIRT).join(', ')}`);
        return { level: 'high', reasons };
    }

    if (category === 'death_incomplete') {
        reasons.push(`Décès acté mais incomplet : ${missingParts(deat).join(', ')}`);
    }

    if (birthEst) {
        const age = currentYear - birthEst.year;
        if (age >= opts.ageThreshold) {
            score += 2;
            reasons.push(`Âge estimé ${age} ans (≥ ${opts.ageThreshold} ans) : décès quasi certain`);
        } else if (birthEst.year >= opts.windowStart && birthEst.year <= opts.windowEnd) {
            score += 1;
            reasons.push(`Naissance ${birthEst.estimated ? 'estimée' : 'actée'} en ${birthEst.year} (fenêtre ${opts.windowStart}-${opts.windowEnd}) : décès probablement postérieur à ${INSEE_COVERAGE_START}`);
        }
        if (birthEst.estimated) {
            score -= 0.5;
            reasons.push(`Naissance déduite (${birthEst.source}), non actée`);
        }
    } else {
        reasons.push('Aucune naissance connue ni déductible : confiance limitée');
    }
    if (lastAlive != null && lastAlive >= INSEE_COVERAGE_START) {
        score += 0.5;
        reasons.push(`Dernier signe de vie en ${lastAlive} : si décès il y a, il est nécessairement dans le périmètre INSEE (≥ ${INSEE_COVERAGE_START})`);
    }
    let level = 'low';
    if (score >= 2) level = 'high';
    else if (score >= 1) level = 'medium';
    return { level, reasons };
}

// opts: { ageThreshold, maxAge, windowStart, windowEnd, includeIncompleteDeath, excludeEstimatedBirth, includeUnknownBirth, ancestorScopeSet }
export function computeMissingDeaths(list, map, fams, opts) {
    const currentYear = new Date().getFullYear();
    const results = [];
    list.forEach(p => {
        if (opts.ancestorScopeSet && !opts.ancestorScopeSet.has(p.id)) return;

        const deat = p.events.DEAT;
        const deathComplete = isEventComplete(deat);
        const birthComplete = isEventComplete(p.events.BIRT);

        let category;
        if (!deathComplete) {
            // Décès manquant (pas de tag) ou incomplet (tag présent, mais date et/ou lieu manquant).
            const buri = p.events.BURI;
            if (buri.hasDate && buri.year != null && buri.year < INSEE_COVERAGE_START) return; // inhumation avant 1970 : hors périmètre INSEE
            if (deat.hasTag && !opts.includeIncompleteDeath) return; // décès incomplet, mais l'utilisateur ne veut voir que les décès totalement absents
            category = deat.hasTag ? 'death_incomplete' : 'death_missing';
        } else if (!birthComplete) {
            // Décès entièrement acté : n'a d'intérêt ici que si ce décès tombe dans le périmètre
            // INSEE (sinon matchID ne peut de toute façon pas aider à compléter la naissance).
            if (deat.year != null && deat.year < INSEE_COVERAGE_START) return;
            category = 'birth_incomplete';
        } else {
            return; // décès et naissance tous deux complets : rien à rechercher
        }

        const birthEst = estimateBirthYear(p, map, fams);
        if (birthEst && birthEst.estimated && opts.excludeEstimatedBirth) return;
        if (!birthEst && !opts.includeUnknownBirth) return;
        // Les filtres d'âge/fenêtre estiment la plausibilité d'un décès postérieur à 1970 : ils ne
        // concernent pas le cas "naissance incomplète", qui a déjà sa propre preuve (décès acté et
        // daté dans le périmètre INSEE), quel que soit l'âge estimé par ailleurs.
        if (category !== 'birth_incomplete') {
            if (birthEst && birthEst.year > opts.windowEnd) return; // né trop récemment pour être une piste plausible
            // Au-delà d'une longévité humaine plausible, l'estimation de naissance est plus probablement
            // erronée (mauvaise source retenue par estimateBirthYear, ex. un ancêtre du XVIe siècle) que
            // la personne réellement centenaire ET absente du fichier des décès.
            if (birthEst && (currentYear - birthEst.year) > opts.maxAge) return;
        }

        const lastAlive = lastKnownAliveYear(p, fams);
        const confidence = computeConfidence(p, birthEst, lastAlive, opts, currentYear, category);
        results.push({ person: p, birthEst, lastAlive, confidence, category });
    });

    const order = { high: 0, medium: 1, low: 2 };
    results.sort((a, b) => order[a.confidence.level] - order[b.confidence.level] || a.person.name.localeCompare(b.person.name));
    return results;
}

// Lien profond vers une recherche pré-remplie sur deces.matchid.io (format vérifié dans le code
// source du front matchID : ln=nom, fn=prénom, bd=date/intervalle de naissance, bc=commune, sex,
// dd=date de décès, dc=commune de décès). Les champs "décès" ne sont ajoutés que s'ils sont déjà
// connus (cas "naissance incomplète" surtout) : ils resserrent alors la recherche sur ce décès
// précis au lieu de faire deviner matchID à partir de la seule naissance, ici justement incomplète.
export function buildMatchIdUrl(p, birthEst) {
    const params = new URLSearchParams();
    const surname = p.surname || guessSurname(p.name);
    const given = p.given || guessGiven(p.name);
    if (surname) params.set('ln', surname);
    if (given) params.set('fn', given);
    if (birthEst) {
        // Marge plus large pour une naissance déduite (l'estimation peut être décalée de quelques
        // années) que pour une naissance actée (recherche resserrée).
        const span = birthEst.estimated ? 3 : 1;
        params.set('bd', `${birthEst.year - span}-${birthEst.year + span}`);
    }
    if (p.birth?.geo?.city) params.set('bc', p.birth.geo.city);
    if (p.sex === 'M' || p.sex === 'F') params.set('sex', p.sex);
    const deat = p.events.DEAT;
    if (deat.year != null) params.set('dd', String(deat.year));
    if (deat.geo?.city) params.set('dc', deat.geo.city);
    return `https://deces.matchid.io/search?${params.toString()}`;
}

// Colonnes attendues par la page d'appariement de masse (deces.matchid.io/link, mapping CSV
// documenté : NOM, PRENOM, DATE_NAISSANCE, COMMUNE_NAISSANCE, DEP_NAISSANCE, PAYS_NAISSANCE, GENRE).
export function buildMatchIdCsvRows(entries) {
    const headers = ['NOM', 'PRENOM', 'DATE_NAISSANCE', 'COMMUNE_NAISSANCE', 'DEP_NAISSANCE', 'PAYS_NAISSANCE', 'GENRE'];
    const rows = entries.map(({ person: p, birthEst }) => [
        p.surname || guessSurname(p.name),
        p.given || guessGiven(p.name),
        birthEst ? birthEst.year : '',
        p.birth?.geo?.city || '',
        p.birth?.geo?.dept ? p.birth.geo.dept.split(' - ')[0] : '',
        p.birth?.geo?.country || '',
        p.sex === 'M' ? 'M' : (p.sex === 'F' ? 'F' : '')
    ]);
    return { headers, rows };
}
