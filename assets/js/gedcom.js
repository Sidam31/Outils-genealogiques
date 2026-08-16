import { GEO, normalizePlace, findDept, BELGIAN_REGIONS } from './geo.js';

// --- PARSER ---
export class GedcomParser {
    constructor() { this.indis = new Map(); this.fams = new Map(); this.globalPlacForm = null; this._curPlaceStub = null; this._curFactValue = null; this._pendingEven = null; this._curCensusEntry = null; this._curResiEntry = null; }
    clean(s) { return s ? s.replace(/@/g,'').trim() : null; }
    getYear(s) { const m = s?.match(/\d{4}/); return m ? parseInt(m[0]) : null; }
    // GEDCOM DATE_APPROXIMATED : préfixe ABT (about), CAL (calculated) ou EST (estimated) sur la
    // valeur DATE, indiquant que l'année n'est pas connue avec certitude (ex. "ABT 1750").
    isApproxDate(s) { return !!s && /\b(ABT|CAL|EST)\b/i.test(s); }
    // Extrait jour/mois/année d'une date GEDCOM complète au format "DD MMM YYYY" (ex. "12 MAY 1900") :
    // le seul format qui permette de calculer un jour de la semaine. Une année seule, "MMM YYYY", ou
    // une date approximative/composite (ABT, BET...AND...) n'y suffit pas et renvoie null.
    parseFullDate(s) {
        if(!s) return null;
        const m = s.trim().match(/\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{3,4})\b/i);
        if(!m) return null;
        const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
        const day = parseInt(m[1]), month = months[m[2].toUpperCase()], year = parseInt(m[3]);
        if(day < 1 || day > 31) return null;
        return { day, month, year };
    }
    // Jour de la semaine (0=dimanche...6=samedi, convention JS) d'une date GEDCOM complète, ou null si
    // le jour/mois est inconnu OU si la date est approximative/composite (ABT, EST, BEF, AFT,
    // BET...AND...) : un jour de la semaine n'a de sens que pour une date certaine. Calendrier
    // grégorien proleptique (Date.UTC) : norme usuelle pour ce calcul en généalogie, y compris sur des
    // dates antérieures à l'adoption du calendrier.
    getWeekday(s) {
        if(!s || /\b(ABT|CAL|EST|CIRCA|ABOUT|BEF|BEFORE|AFT|AFTER|BET|BETWEEN|FROM|TO)\b/i.test(s)) return null;
        const d = this.parseFullDate(s);
        if(!d) return null;
        return new Date(Date.UTC(d.year, d.month, d.day)).getUTCDay();
    }
    newEventFlags() { return { hasTag:false, hasDate:false, year:null, approx:false, geo:null }; }
    newCensusEntry() { return { year:null, approx:false, geo:null }; }
    newResiEntry() { return { year:null, approx:false, geo:null }; }
    newPlaceStub(raw) { return { raw, form:null, lat:null, lon:null, dept:null, region:null, country:null, city:null }; }
    // Parse une coordonnée GEDCOM LATI/LONG du type "N47.314010" ou "W2.311220" en degrés décimaux signés.
    parseCoord(v) {
        if(!v) return null;
        const m = v.trim().match(/^([NSEW])?(-?\d+(?:\.\d+)?)/i);
        if(!m) return null;
        const val = parseFloat(m[2]);
        if(isNaN(val)) return null;
        const dir = (m[1] || '').toUpperCase();
        return (dir === 'S' || dir === 'W') ? -Math.abs(val) : Math.abs(val);
    }
    parse(txt) {
        if(txt.charCodeAt(0)===0xFEFF) txt=txt.slice(1);
        const lines = txt.split(/\r?\n/);
        let cur=null, type=null, headPlacCtx=false;
        const re = /^\s*(\d+)\s+(@[^@]+@|[A-Za-z0-9_]+)(?:\s+(.*))?$/;
        for(const line of lines) {
            const m = line.match(re); if(!m) continue;
            const lvl=parseInt(m[1]), tag=m[2], val=m[3]||"";
            if(lvl===0) {
                this._curPlaceStub = null;
                if(val==='INDI') {
                    type='INDI';
                    cur={
                        id:this.clean(tag), name:'Inconnu', given:null, surname:null, birth:{}, death:{}, fams:[], childrenCount:0, occupations:[],
                        // EMIG/IMMI suivent le même schéma simple (une seule "case") que BIRT/DEAT/BURI/BAPM :
                        // contrairement à CENS/RESI ci-dessous, une personne n'émigre/n'immigre en général
                        // qu'une fois dans un fichier GEDCOM donné, donc pas d'accumulation en tableau ici.
                        events: { BIRT:this.newEventFlags(), DEAT:this.newEventFlags(), BURI:this.newEventFlags(), BAPM:this.newEventFlags(), CENS:this.newEventFlags(), RESI:this.newEventFlags(), EMIG:this.newEventFlags(), IMMI:this.newEventFlags() },
                        // Une personne peut apparaître dans PLUSIEURS recensements ("1 CENS" répété,
                        // un par passage) : events.CENS (ci-dessus) ne garde que le dernier rencontré
                        // (une seule "case" par type d'événement, comme BIRT/DEAT qui n'arrivent
                        // qu'une fois) ; censusEvents accumule chaque occurrence pour permettre à
                        // l'outil "Recensements manquants" de savoir PRÉCISÉMENT quelles années sont
                        // déjà actées et lesquelles restent à rechercher.
                        censusEvents: [],
                        // Même logique que censusEvents ci-dessus, appliquée à "1 RESI" (events.RESI ne
                        // garde que la dernière occurrence) : utilisé par la frise de vie pour afficher
                        // tous les domiciles successifs plutôt que le seul dernier connu.
                        resiEvents: [],
                        // Capture générique de TOUTES les occurrences de "1 EVEN"/"1 FACT", quel que soit
                        // leur TYPE (contrairement à occupations/censusEvents ci-dessus, qui ne retiennent
                        // que les faits reconnus comme métier ou recensement) : sert de matière première à
                        // la frise de vie pour afficher les faits personnalisés (ex. "Domicile",
                        // "Condamnation", "Service militaire"...) que le fichier GEDCOM peut contenir.
                        otherEvents: []
                    };
                    this.indis.set(cur.id, cur);
                }
                else if(val==='FAM') { type='FAM'; cur={id:this.clean(tag), children:[], marr:{hasTag:false, hasDate:false}, div:{hasTag:false, hasDate:false}}; this.fams.set(cur.id, cur); }
                else if(val==='HEAD') { type='HEAD'; cur=null; headPlacCtx=false; }
                else { type=null; cur=null; }
            } else if(type==='HEAD') {
                // En-tête GEDCOM : "1 PLAC" / "2 FORM ..." déclare le format par défaut des lieux
                // pour tout le fichier (ex. "Commune,Département,Région,Pays"), utilisé en secours
                // par analyzePlace quand un lieu donné n'a pas son propre "3 FORM".
                if(lvl===1) headPlacCtx = (tag==='PLAC');
                else if(lvl===2 && tag==='FORM' && headPlacCtx) this.globalPlacForm = val.trim();
            } else if(cur) {
                if(type==='INDI') this.parseIndi(cur, lvl, tag, val);
                if(type==='FAM') this.parseFam(cur, lvl, tag, val);
            }
        }
        this.finalizeAllGeo();
        this.postProcess(); return Array.from(this.indis.values());
    }
    parseIndi(i, lvl, t, v) {
        if(lvl===1) {
            this._curPlaceStub = null;
            i._ctx=t;
            // "/Surname/" est parfois collé au prénom sans espace dans le fichier source
            // (ex. "Jean/Dupont/") : on force un espace autour du nom entre slashes plutôt que de
            // simplement retirer les "/", puis on nettoie les espaces multiples qui en résultent.
            if(t==='NAME') {
                i.name=v.replace(/\/([^\/]*)\//g, ' $1 ').replace(/\s+/g, ' ').trim();
                // Prénom/nom déduits de "Prénom /NOM/" : servent de repli si le fichier ne fournit
                // pas de sous-tags GIVN/SURN dédiés (voir lvl===2 ci-dessous, qui prime sur ceci).
                const nm = v.match(/^([^\/]*)\/([^\/]*)\//);
                if(nm) { i.given = nm[1].trim() || null; i.surname = nm[2].trim() || null; }
            }
            if(t==='FAMC') i.famc=this.clean(v);
            if(t==='FAMS') i.fams.push(this.clean(v));
            if(t==='SEX') i.sex=v.trim().toUpperCase().charAt(0); // 'M' ou 'F' (ou 'U'/'X' selon la source)
            // Une personne peut avoir plusieurs "1 OCCU" (métiers successifs au fil des actes) :
            // on les garde tous plutôt que d'écraser avec le dernier rencontré.
            if(t==='OCCU' && v && v.trim()) i.occupations.push(v.trim());
            if(['BIRT','DEAT','BURI','BAPM','CHR','EMIG','IMMI'].includes(t)) {
                const key = t==='CHR' ? 'BAPM' : t;
                i.events[key].hasTag = true;
            }
            if(t==='CENS') {
                i.events.CENS.hasTag = true;
                // Nouvelle occurrence à chaque "1 CENS" : poussée immédiatement dans le tableau (pas
                // besoin de "flush" au tag suivant), _curCensusEntry garde juste la référence pour
                // que les DATE/PLAC de niveau 2 qui suivent la mutent en place.
                const entry = this.newCensusEntry();
                i.censusEvents.push(entry);
                this._curCensusEntry = entry;
            }
            if(t==='RESI') {
                i.events.RESI.hasTag = true;
                // Comme pour CENS ci-dessus : nouvelle occurrence à chaque "1 RESI", poussée immédiatement
                // dans resiEvents ; _curResiEntry garde la référence pour que DATE/PLAC (niveau 2) la mutent.
                const resiEntry = this.newResiEntry();
                i.resiEvents.push(resiEntry);
                this._curResiEntry = resiEntry;
            }
            // Certains logiciels (Ancestris, Gramps...) encodent le métier — ou un recensement —
            // comme un fait générique "1 FACT <valeur>" / "1 EVEN <valeur>" avec "2 TYPE <...>"
            // plutôt qu'un tag standard (OCCU / CENS). On mémorise la valeur en attendant de voir
            // si son TYPE la confirme (traité au niveau 2 ci-dessous) : sans TYPE reconnu, elle est ignorée.
            this._curFactValue = (t==='FACT' && v && v.trim()) ? v.trim() : null;
            if(t==='EVEN' || t==='FACT') {
                // Entrée générique poussée immédiatement dans otherEvents (comme pour CENS/RESI ci-dessus),
                // avec la valeur brute de la ligne "1 EVEN"/"1 FACT" elle-même (indépendamment de
                // _curFactValue, qui ne capture que FACT) : TYPE/DATE/PLAC (niveau 2) la mutent ensuite en
                // place. _pendingEven reste l'objet historique utilisé par la logique occupation/recensement
                // ci-dessous ; "entry" y est ajouté comme simple référence croisée, sans rien changer aux
                // champs existants (hasDate/year/approx/geo/isCens/censusEntry).
                const otherEntry = { tag:t, typeLabel:null, value:(v && v.trim()) ? v.trim() : null, year:null, approx:false, geo:null, isCens:false, isOccupation:false };
                i.otherEvents.push(otherEntry);
                this._pendingEven = { hasDate:false, year:null, approx:false, geo:null, isCens:false, entry:otherEntry };
            } else {
                this._pendingEven = null;
            }
        }
        else if(lvl===2) {
            if(t!=='PLAC') this._curPlaceStub = null; // DATE/ADDR/SOUR... referment le contexte du lieu précédent
            // GIVN/SURN (sous NAME) priment sur le repli "Prénom /NOM/" du niveau 1 ci-dessus.
            if(t==='GIVN' && i._ctx==='NAME' && v && v.trim()) i.given = v.trim();
            if(t==='SURN' && i._ctx==='NAME' && v && v.trim()) i.surname = v.trim();
            if(t==='DATE') {
                const y=this.getYear(v);
                const approx=this.isApproxDate(v);
                if(i._ctx==='BIRT') { i.birth.year=y; i.birth.approx=approx; }
                if(i._ctx==='DEAT') {
                    i.death.year=y; i.death.approx=approx;
                    // Jour/mois (en plus de l'année déjà nécessaire ailleurs) : seulement dispo pour
                    // une date complète non approximative (voir parseFullDate) — utilisé pour afficher
                    // la date de décès complète dans le mode Successions plutôt que la seule année.
                    const full = approx ? null : this.parseFullDate(v);
                    i.death.day = full ? full.day : null;
                    i.death.month = full ? full.month : null;
                }
                if(['BIRT','DEAT','BURI','BAPM','CHR','EMIG','IMMI'].includes(i._ctx)) {
                    const key = i._ctx==='CHR' ? 'BAPM' : i._ctx;
                    if(v && v.trim().length) { i.events[key].hasDate = true; i.events[key].year = y; i.events[key].approx = approx; }
                }
                if((i._ctx==='CENS' || i._ctx==='RESI') && v && v.trim().length) {
                    i.events[i._ctx].hasDate = true; i.events[i._ctx].year = y; i.events[i._ctx].approx = approx;
                    if(i._ctx==='CENS' && this._curCensusEntry) { this._curCensusEntry.year = y; this._curCensusEntry.approx = approx; }
                    if(i._ctx==='RESI' && this._curResiEntry) { this._curResiEntry.year = y; this._curResiEntry.approx = approx; }
                }
                if((i._ctx==='EVEN' || i._ctx==='FACT') && this._pendingEven && v && v.trim().length) {
                    this._pendingEven.hasDate = true; this._pendingEven.year = y; this._pendingEven.approx = approx;
                    if(this._pendingEven.entry) { this._pendingEven.entry.year = y; this._pendingEven.entry.approx = approx; }
                    // Ordre GEDCOM habituel : TYPE précède DATE/PLAC (pas l'inverse). Si le TYPE a
                    // déjà confirmé ce EVEN/FACT comme recensement, on écrit directement dans le
                    // recensement plutôt que de compter uniquement sur le repli "TYPE arrive après"
                    // géré par le bloc TYPE ci-dessous.
                    if(this._pendingEven.isCens) {
                        i.events.CENS.hasDate = true; i.events.CENS.year = y; i.events.CENS.approx = approx;
                        if(this._pendingEven.censusEntry) { this._pendingEven.censusEntry.year = y; this._pendingEven.censusEntry.approx = approx; }
                    }
                }
            }
            if(t==='PLAC') {
                const stub = this.newPlaceStub(v);
                this._curPlaceStub = stub;
                if(i._ctx==='BIRT') i.birth.geo=stub;
                if(i._ctx==='DEAT') i.death.geo=stub;
                if(['BIRT','DEAT','BURI','BAPM','CHR','EMIG','IMMI'].includes(i._ctx)) {
                    const key = i._ctx==='CHR' ? 'BAPM' : i._ctx;
                    i.events[key].geo = stub;
                }
                if(i._ctx==='CENS' || i._ctx==='RESI') {
                    i.events[i._ctx].geo = stub;
                    if(i._ctx==='CENS' && this._curCensusEntry) this._curCensusEntry.geo = stub;
                    if(i._ctx==='RESI' && this._curResiEntry) this._curResiEntry.geo = stub;
                }
                if((i._ctx==='EVEN' || i._ctx==='FACT') && this._pendingEven) {
                    this._pendingEven.geo = stub;
                    if(this._pendingEven.entry) this._pendingEven.entry.geo = stub;
                    if(this._pendingEven.isCens) {
                        i.events.CENS.geo = stub;
                        if(this._pendingEven.censusEntry) this._pendingEven.censusEntry.geo = stub;
                    }
                }
            }
            // Capture générique et inconditionnelle du TYPE de tout "1 EVEN"/"1 FACT" dans otherEvents,
            // indépendamment de sa reconnaissance (ou non) comme métier/recensement ci-dessous : c'est
            // ce TYPE qui sert de libellé à la frise de vie pour les faits personnalisés (ex. "Domicile",
            // "Condamnation", "Service militaire").
            if(t==='TYPE' && (i._ctx==='EVEN' || i._ctx==='FACT') && this._pendingEven?.entry) {
                this._pendingEven.entry.typeLabel = v.trim();
            }
            if(t==='TYPE' && i._ctx==='FACT' && this._curFactValue && /occupation/i.test(v)) {
                i.occupations.push(this._curFactValue);
                this._curFactValue = null;
                if(this._pendingEven?.entry) this._pendingEven.entry.isOccupation = true;
            }
            // "1 EVEN"/"1 FACT" confirmé comme recensement par son TYPE : on rattache au recensement
            // ce qui avait déjà été mis en attente (date/lieu, si TYPE arrive après eux) ET on marque
            // isCens pour que les DATE/PLAC qui arriveraient APRÈS ce TYPE (l'ordre GEDCOM habituel)
            // s'écrivent directement dans le recensement (voir les blocs DATE/PLAC ci-dessus).
            if(t==='TYPE' && (i._ctx==='EVEN' || i._ctx==='FACT') && this._pendingEven && /recens|census|d[ée]nombrement/i.test(v)) {
                const p = this._pendingEven;
                p.isCens = true;
                if(p.entry) p.entry.isCens = true;
                i.events.CENS.hasTag = true;
                if(p.hasDate) { i.events.CENS.hasDate = true; i.events.CENS.year = p.year; i.events.CENS.approx = p.approx; }
                if(p.geo) i.events.CENS.geo = p.geo;
                // Occurrence ajoutée au tableau MAINTENANT (avec ce qui est déjà connu de ce
                // EVEN/FACT) ; p.censusEntry garde la référence pour que les DATE/PLAC arrivant
                // APRÈS ce TYPE (ordre GEDCOM habituel) la mutent en place (voir DATE/PLAC ci-dessus).
                const entry = this.newCensusEntry();
                entry.year = p.hasDate ? p.year : null;
                entry.approx = p.approx;
                entry.geo = p.geo;
                i.censusEvents.push(entry);
                p.censusEntry = entry;
            }
        }
        // "3 FORM" (hiérarchie propre à ce lieu) et "3 MAP / 4 LATI / 4 LONG" (coordonnées GPS),
        // rattachés au lieu (PLAC) qui vient d'être ouvert plus haut.
        else if(lvl===3 && this._curPlaceStub) {
            if(t==='FORM') this._curPlaceStub.form = v.trim();
        }
        else if(lvl===4 && this._curPlaceStub) {
            if(t==='LATI') this._curPlaceStub.lat = this.parseCoord(v);
            if(t==='LONG') this._curPlaceStub.lon = this.parseCoord(v);
        }
    }
    parseFam(f, lvl, t, v) {
        if(lvl===1) {
            this._curPlaceStub = null;
            f._ctx=t;
            if(t==='HUSB') f.husb=this.clean(v);
            if(t==='WIFE') f.wife=this.clean(v);
            if(t==='CHIL') f.children.push(this.clean(v));
            if(t==='MARR') f.marr.hasTag = true;
            if(t==='DIV') f.div.hasTag = true;
        }
        // MARR et DIV partagent la même mécanique (DATE/PLAC de niveau 2) : "target" pointe vers le
        // sous-objet (f.marr ou f.div) correspondant au contexte courant.
        else if(lvl===2 && (f._ctx==='MARR' || f._ctx==='DIV')) {
            if(t!=='PLAC') this._curPlaceStub = null;
            const target = f._ctx==='MARR' ? f.marr : f.div;
            if(t==='DATE') {
                target.year=this.getYear(v);
                if(v && v.trim().length) target.hasDate = true;
                target.weekday = this.getWeekday(v); // null si la date n'a pas de jour/mois exploitable
            }
            if(t==='PLAC') {
                const stub = this.newPlaceStub(v);
                this._curPlaceStub = stub;
                target.geo = stub;
            }
        }
        else if(lvl===3 && this._curPlaceStub) {
            if(t==='FORM') this._curPlaceStub.form = v.trim();
        }
        else if(lvl===4 && this._curPlaceStub) {
            if(t==='LATI') this._curPlaceStub.lat = this.parseCoord(v);
            if(t==='LONG') this._curPlaceStub.lon = this.parseCoord(v);
        }
    }
    // Calcule dept/region/country/city pour chaque lieu rencontré, une fois le fichier entièrement lu
    // (nécessaire car le "3 FORM" propre à un lieu, quand il existe, arrive APRÈS la ligne PLAC).
    finalizeAllGeo() {
        const finalize = geo => {
            if(!geo) return;
            const r = this.analyzePlace(geo.raw, geo.form || this.globalPlacForm);
            geo.dept = r.dept; geo.region = r.region; geo.country = r.country; geo.city = r.city;
        };
        this.indis.forEach(i => {
            finalize(i.birth.geo); finalize(i.death.geo);
            ['BIRT','DEAT','BURI','BAPM','CENS','RESI','EMIG','IMMI'].forEach(k => finalize(i.events[k].geo));
            // Chaque occurrence de recensement a son propre lieu (pas seulement le dernier, gardé
            // dans events.CENS.geo) : toutes doivent être finalisées individuellement.
            i.censusEvents.forEach(entry => finalize(entry.geo));
            i.resiEvents.forEach(entry => finalize(entry.geo));
            i.otherEvents.forEach(entry => finalize(entry.geo));
        });
        this.fams.forEach(f => { finalize(f.marr.geo); finalize(f.div.geo); });
    }
    analyzePlace(str, formStr) {
        if(!str) return { dept:null, region:null, country:null, city:null };
        const norm = normalizePlace(str);
        let country=null, dept=null, region=null, city=null;

        // 1) Alignement positionnel via le "PLAC.FORM" (propre au lieu, sinon celui de l'en-tête du
        // fichier) quand son nombre de champs déclarés correspond exactement au nombre de segments
        // séparés par des virgules de CE lieu : c'est fiable et évite toute ambiguïté de nom.
        // Si les décomptes diffèrent (ex. FORM à 7 niveaux mais valeur n'en renseignant que 3), on ne
        // peut pas savoir quels niveaux ont été omis : on se rabat alors sur la recherche floue (2).
        if(formStr) {
            const rawParts = str.split(',').map(s => s.trim());
            const formParts = formStr.split(',').map(s => s.trim());
            if(rawParts.length === formParts.length) {
                const idxOf = re => formParts.findIndex(f => re.test(normalizePlace(f)));
                const countryIdx = idxOf(/pays|country/);
                const regionIdx = idxOf(/region|province|state|etat/);
                const deptIdx = idxOf(/departement|department|county|comte/);
                const cityIdx = idxOf(/commune|ville|city|town/);
                if(countryIdx >= 0 && rawParts[countryIdx]) {
                    const segNorm = normalizePlace(rawParts[countryIdx]);
                    const hit = GEO.countryEntriesNorm.find(([nk]) => segNorm.includes(nk));
                    country = hit ? hit[1] : rawParts[countryIdx];
                }
                if(deptIdx >= 0 && rawParts[deptIdx]) {
                    const segNorm = normalizePlace(rawParts[deptIdx]);
                    dept = findDept(segNorm) || GEO.deptEnglishAliases[segNorm] || null;
                    if(dept) country = country || "France";
                }
                if(regionIdx >= 0 && rawParts[regionIdx]) {
                    const segNorm = normalizePlace(rawParts[regionIdx]);
                    const hit = GEO.regionEntriesNorm.find(([nr]) => segNorm===nr || segNorm.includes(nr));
                    if(hit) region = hit[1];
                }
                // Commune : champ explicitement libellé "Commune/Ville/City/Town" dans le FORM,
                // sinon (FORM du type "Lieudit, Commune, ...") le champ juste avant le département.
                if(cityIdx >= 0 && rawParts[cityIdx]) city = rawParts[cityIdx];
                else if(deptIdx > 0 && rawParts[deptIdx - 1]) city = rawParts[deptIdx - 1];
            }
        }

        // 2) Sans FORM exploitable (absent, ou décompte de champs différent), la plupart des
        // hiérarchies de lieux françaises suivent quand même une convention fixe : du plus précis au
        // plus général, avec le pays en dernier et la région juste avant ("...,Département,Région,
        // Pays"). On ne fait confiance à cette position que si elle est CONFIRMÉE pour cette valeur
        // précise (le dernier segment est bien un pays connu ET l'avant-dernier une région connue) :
        // ça évite de se tromper sur des valeurs à 3 champs qui omettent la région (ex. "Commune,
        // Département, Pays"). Une fois confirmé, le segment "Département" est sûr à son tour, donc
        // on peut y appliquer sans risque la table de traduction anglaise (ex. "North" -> "Nord") :
        // contrairement à la recherche floue globale (3), on sait déjà PRÉCISÉMENT où regarder.
        if(!dept) {
            const posParts = str.split(',').map(s => s.trim());
            if(posParts.length >= 3) {
                const lastNorm = normalizePlace(posParts[posParts.length - 1]);
                const beforeLastNorm = normalizePlace(posParts[posParts.length - 2]);
                const countryHit = GEO.countryEntriesNorm.find(([nk]) => lastNorm.includes(nk));
                const regionHit = GEO.regionEntriesNorm.find(([nr]) => beforeLastNorm === nr);
                if(countryHit && regionHit) {
                    if(!country) country = countryHit[1];
                    if(!region) region = regionHit[1];
                    const deptSegNorm = normalizePlace(posParts[posParts.length - 3]);
                    dept = findDept(deptSegNorm) || GEO.deptEnglishAliases[deptSegNorm] || null;
                }
            }
        }

        // 3) Recherche floue de secours sur la chaîne complète (comble ce que (1) et (2) n'ont pas trouvé).
        if(!country) {
            const hit = GEO.countryEntriesNorm.find(([nk]) => norm.includes(nk));
            if(hit) country = hit[1];
        }
        if(!region && (!country || country==="France" || country==="Belgique")) {
            const hit = GEO.regionEntriesNorm.find(([nr]) => norm.includes(nr));
            if(hit) { region = hit[1]; country = BELGIAN_REGIONS.has(hit[1]) ? "Belgique" : "France"; }
        }
        if(!dept && (!country || country==="France")) {
            // Code INSEE complet (5 chiffres : 2 dept + 3 commune, ou 97xxx pour DOM)
            const codeInsee = str.match(/\b(97[1-6]|2[AB]|0[1-9]|[1-8]\d|9[0-5])\d{3}\b/);
            if(codeInsee && GEO.deptLabels[codeInsee[1]]) { dept = codeInsee[1]; country = "France"; }
            if(!dept) dept = findDept(norm);
            if(dept) country = "France";
        }
        // Commune : à défaut d'un FORM exploitable, le premier segment est quasi-toujours le lieu le
        // plus précis (commune, parfois précédé d'un lieu-dit qui reste acceptable pour une recherche).
        if(!city) {
            const parts = str.split(',').map(s => s.trim()).filter(Boolean);
            if(parts.length) city = parts[0];
        }

        let deptDisp = null;
        if(dept) {
            const l = GEO.deptLabels[dept];
            deptDisp = l ? `${dept} - ${l}` : dept;
        }
        if(!country && dept) country = "France";
        if(!country && !dept && !region) country = "Inconnu";
        return { dept:deptDisp, region, country, city };
    }
    postProcess() {
        this.indis.forEach(i => {
            if(i.famc) { const f=this.fams.get(i.famc); if(f) { if(f.husb) i.fatherId=f.husb; if(f.wife) i.motherId=f.wife; } }
            if(i.birth.year && i.death.year) i.ageDeath = i.death.year - i.birth.year;
            let fMarrY=null, fChildY=null, tot=0;
            const childrenYears = []; // Collecter les années de naissance des enfants
            i.fams.forEach(fid => {
                const f=this.fams.get(fid); if(!f) return;
                tot+=f.children.length;
                if(f.marr?.year) { if(!fMarrY || f.marr.year < fMarrY) { fMarrY=f.marr.year; i.marrGeo=f.marr.geo; } }
                f.children.forEach(cid => {
                    const c=this.indis.get(cid);
                    if(c?.birth.year) {
                        childrenYears.push(c.birth.year);
                        if(!fChildY || c.birth.year < fChildY) fChildY=c.birth.year;
                    }
                });
            });
            i.childCount=tot;
            i.childrenYears = childrenYears.sort((a,b) => a-b); // Trier par ordre chronologique
            i.marrYear = fMarrY; // Stocker l'année de mariage sur l'individu
            if(i.birth.year && fMarrY) i.ageMarr=Math.max(0, fMarrY-i.birth.year);
            if(i.birth.year && fChildY) i.ageFirstChild=Math.max(0, fChildY-i.birth.year);
        });
    }
}

// --- LECTURE FICHIER (détection d'encodage) ---
// FileReader.readAsText() décode toujours en UTF-8 (ou l'encodage de la page), quel que soit
// l'encodage réel du fichier : un GEDCOM déclarant "1 CHAR ANSI" (courant pour les exports plus
// anciens, ex. Windows-1252) ou "1 CHAR MACINTOSH" ressortait donc avec des caractères accentués
// corrompus. On lit les octets bruts et on choisit le bon décodeur nous-mêmes.
export function detectGedcomEncoding(bytes) {
    if(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
    if(bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
    if(bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
    // Pas de BOM : on sonde la ligne d'en-tête "1 CHAR ..." pour connaître l'encodage déclaré. Les
    // mots-clés GEDCOM sont en ASCII (donc lisibles quel que soit l'encodage réel du fichier), d'où
    // le décodage "windows-1252" ici qui ne sert qu'à repérer ce mot-clé, jamais à décoder le texte final.
    const probe = new TextDecoder('windows-1252').decode(bytes.slice(0, 4000));
    const m = probe.match(/\r?\n1\s+CHAR\s+([A-Za-z0-9_-]+)/i);
    const declared = (m ? m[1] : '').toUpperCase();
    if(declared === 'UNICODE' || declared === 'UTF-16' || declared === 'UTF16') return 'utf-16le'; // "UNICODE" (GEDCOM 5.5) signifiait UTF-16
    if(declared === 'MACINTOSH' || declared === 'MAC') return 'macintosh';
    if(declared === 'UTF-8' || declared === 'UTF8') return 'utf-8';
    // ANSI / ASCII / IBMPC / OEM / valeur absente : pas d'indication Unicode fiable. On vérifie si
    // le contenu est un UTF-8 valide (la plupart des exports récents le sont même sans le déclarer) ;
    // sinon on suppose Windows-1252 ("ANSI"), de loin le plus courant pour les exports occidentaux.
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'utf-8'; }
    catch(e) { return 'windows-1252'; }
}
export async function readGedcomFile(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const encoding = detectGedcomEncoding(bytes);
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
}
