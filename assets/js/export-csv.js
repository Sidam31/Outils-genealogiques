// --- EXPORT CSV COMPLET DU GEDCOM (index.html) ---
// Une ligne par individu : identité, naissance/décès, parents, conjoint(s)/mariage(s) et tous les
// autres événements (baptême, inhumation, émigration/immigration, recensements, résidences, faits
// personnalisés EVEN/FACT, professions) réunis dans une seule colonne texte.
import { formatFullDate } from './utils.js';
import { labelForOther } from './timeline.js';

function placeRaw(geo) { return geo?.raw || ''; }

// Un individu peut avoir plusieurs mariages (person.fams) : les trois listes ci-dessous restent
// alignées par index (conjoint N / date N / lieu N) plutôt que de ne garder que le premier mariage.
function spousesAndMarriages(person, famsMap, indisMap) {
    const spouses = [], dates = [], places = [];
    (person.fams || []).forEach(famId => {
        const fam = famsMap.get(famId);
        if (!fam) return;
        const spouseId = fam.husb === person.id ? fam.wife : (fam.wife === person.id ? fam.husb : null);
        const spouse = spouseId ? indisMap.get(spouseId) : null;
        spouses.push(spouse?.name || spouseId || '');
        dates.push(fam.marr?.hasDate ? formatFullDate(fam.marr) : '');
        places.push(placeRaw(fam.marr?.geo));
    });
    return { spouses, dates, places };
}

function formatOccupations(person) {
    return (person.occupations || []).map(o => {
        if (o.yearStart == null) return o.profession;
        return o.yearStart === o.yearEnd ? `${o.profession} (${o.yearStart})` : `${o.profession} (${o.yearStart}-${o.yearEnd})`;
    }).join(' | ');
}

function formatEvent(label, dateEvt, geo) {
    const date = dateEvt && dateEvt.year != null ? formatFullDate(dateEvt) : '';
    const place = placeRaw(geo);
    return `${label}${date ? ' : ' + date : ''}${place ? ' (' + place + ')' : ''}`;
}

// Tous les événements hors naissance/décès/mariage (déjà en colonnes dédiées) : baptême, inhumation,
// émigration/immigration, chaque recensement, chaque résidence, et chaque fait personnalisé EVEN/FACT
// (ADOP, TITL...). Les EVEN/FACT déjà reconnus comme recensement/résidence (isCens/isResi) sont
// écartés ici pour ne pas les compter deux fois (déjà repris via censusEvents/resiEvents).
function formatOtherEvents(person) {
    const parts = [];
    [['BAPM', 'Baptême'], ['BURI', 'Inhumation'], ['EMIG', 'Émigration'], ['IMMI', 'Immigration']].forEach(([code, label]) => {
        const e = person.events?.[code];
        if (e && e.hasTag) parts.push(formatEvent(label, e, e.geo));
    });
    (person.censusEvents || []).forEach(entry => parts.push(formatEvent('Recensement', entry, entry.geo)));
    (person.resiEvents || []).forEach(entry => parts.push(formatEvent('Résidence', entry, entry.geo)));
    (person.otherEvents || []).forEach(entry => {
        if (entry.isCens || entry.isResi) return;
        parts.push(formatEvent(labelForOther(entry), entry, entry.geo));
    });
    return parts.join(' | ');
}

export function buildFullGedcomCsvRows(list, indisMap, famsMap) {
    const headers = [
        'ID', 'NOM_AFFICHE', 'NOM', 'PRENOM', 'SEXE',
        'DATE_NAISSANCE', 'LIEU_NAISSANCE',
        'DATE_DECES', 'LIEU_DECES',
        'PERE', 'MERE',
        'CONJOINTS', 'DATES_MARIAGE', 'LIEUX_MARIAGE',
        'NB_ENFANTS', 'PROFESSIONS', 'AUTRES_EVENEMENTS'
    ];
    const rows = list.map(p => {
        const { spouses, dates, places } = spousesAndMarriages(p, famsMap, indisMap);
        return [
            p.id,
            p.name || '',
            p.surname || '',
            p.given || '',
            p.sex === 'M' ? 'M' : (p.sex === 'F' ? 'F' : ''),
            p.birth?.year != null ? formatFullDate(p.birth) : '',
            placeRaw(p.birth?.geo),
            p.death?.year != null ? formatFullDate(p.death) : '',
            placeRaw(p.death?.geo),
            indisMap.get(p.fatherId)?.name || '',
            indisMap.get(p.motherId)?.name || '',
            spouses.join(' | '),
            dates.join(' | '),
            places.join(' | '),
            p.childCount || 0,
            formatOccupations(p),
            formatOtherEvents(p)
        ];
    });
    return { headers, rows };
}
