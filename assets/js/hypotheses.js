// ============================================================
// --- Outil "Parentés hypothétiques" (reconstitution de filiations non actées, ex. tutelles) ---
// Réutilise le fichier GEDCOM chargé depuis l'accueil (comme les autres outils) plutôt que
// d'avoir son propre chargeur de fichier ; un petit générateur "scénario rapide" à 3 personnes
// reste disponible pour prototyper une hypothèse sans avoir de fichier sous la main.
// ============================================================
export function initHypotheses() {
    let hypGedData = { individuals: {}, families: {} };
    let hypPivotId = null;
    let hypotheses = [];
    let hypCounter = 0;
    let hypManualPos = {}; // nodeKey -> {x,y}, positions déplacées à la souris
    let hypLevelMult = {}; // génération -> multiplicateur d'espacement horizontal (Ctrl+clic)

    // Individu de référence obligatoire ; père/mère optionnels ; fratrie optionnelle. Si des
    // frères/sœurs sont fournis sans père ni mère nommés, des parents anonymes sont créés pour les
    // rattacher (permet de prototyper une fratrie dont on ne connaît pas encore les parents).
    function buildQuickScenario(refName, fatherName, motherName, siblingNames) {
        const individuals = {};
        const families = {};
        let nextId = 1;
        const newId = () => "Q" + (nextId++);

        const refId = newId();
        individuals[refId] = { id: refId, name: refName, sex: "", famc: null, fams: [] };

        const hasParents = !!(fatherName || motherName);
        const hasSiblings = siblingNames.length > 0;
        if (hasParents || hasSiblings) {
            const fatherId = newId(), motherId = newId(), famId = newId();
            individuals[fatherId] = { id: fatherId, name: fatherName || "(père inconnu)", sex: "M", famc: null, fams: [famId] };
            individuals[motherId] = { id: motherId, name: motherName || "(mère inconnu)", sex: "F", famc: null, fams: [famId] };
            const chil = [refId];
            individuals[refId].famc = famId;
            siblingNames.forEach(name => {
                const sid = newId();
                individuals[sid] = { id: sid, name, sex: "", famc: famId, fams: [] };
                chil.push(sid);
            });
            families[famId] = { id: famId, husb: fatherId, wife: motherId, chil };
        }
        return { individuals, families };
    }
    // Adapte le Map/Map produit par GedcomParser (partagé avec les autres outils) vers la forme
    // {individuals, families} attendue par les algorithmes de parenté ci-dessous.
    function buildHypGedDataFromApp(mapData, famsData) {
        const individuals = {};
        mapData.forEach((i, id) => { individuals[id] = { id, name: i.name, sex: i.sex || '', famc: i.famc || null, fams: i.fams || [] }; });
        const families = {};
        famsData.forEach((f, id) => { families[id] = { id, husb: f.husb || null, wife: f.wife || null, chil: f.children || [] }; });
        return { individuals, families };
    }

    // Chaque "slot" (side,g,index) est traité comme un individu potentiellement distinct des
    // autres, mais rien n'empêche une consanguinité réelle dans le couple pivot (deux slots pointant
    // en fait vers la même personne, ex. cousins germains mariés). L'algorithme de parenté ne s'en
    // soucie pas ici (il ne fait que décrire des POSITIONS), mais un futur calcul de plausibilité ne
    // doit pas supposer que tous les ascendants énumérés par hypScanAscendants sont des personnes
    // distinctes.
    function hypStepsFor(side, g, index) {
        const steps = [side === "paternel" ? "F" : "M"];
        for (let b = g - 2; b >= 0; b--) steps.push(((index >> b) & 1) === 0 ? "F" : "M");
        return steps;
    }
    function hypAncestorAt(data, indiId, steps) {
        let cur = indiId;
        for (const s of steps) {
            const indi = data.individuals[cur];
            if (!indi || !indi.famc) return null;
            const fam = data.families[indi.famc];
            if (!fam) return null;
            cur = s === "F" ? fam.husb : fam.wife;
            if (!cur) return null;
        }
        return data.individuals[cur] || null;
    }
    function hypScanAscendants(pivot, gens) {
        const found = [];
        for (let g = 1; g <= gens; g++) {
            const slots = Math.pow(2, g - 1);
            for (const side of ["paternel", "maternel"]) {
                for (let index = 0; index < slots; index++) {
                    const steps = hypStepsFor(side, g, index);
                    const indi = hypAncestorAt(hypGedData, pivot, steps);
                    if (indi) found.push({ side, g, index, indi });
                }
            }
        }
        return found;
    }
    // Frères et sœurs (germains, consanguins ou utérins confondus : quiconque partage la même
    // fiche famille "famc") de la personne donnée, hors elle-même.
    function hypGetSiblings(indiId) {
        const indi = hypGedData.individuals[indiId];
        if (!indi || !indi.famc) return [];
        const fam = hypGedData.families[indi.famc];
        if (!fam) return [];
        return (fam.chil || []).filter(id => id !== indiId).map(id => hypGedData.individuals[id]).filter(Boolean);
    }

    // Degré = up (générations jusqu'à l'ancêtre commun) + down (générations jusqu'à la personne citée).
    // "cousin breton" (cousin à la mode de Bretagne) traité comme synonyme régional de
    // "cousin issu de germain". "cousin germain" et "cousin remué de germain" traités comme
    // synonymes, tous deux à montée 3 / descente 3 (arrière-grand-parent commun).
    const HYP_TERM_DICT = {
        oncle: { up: 1, down: 2 }, tante: { up: 1, down: 2 }, neveu_niece: { up: 2, down: 1 },
        cousin_germain: { up: 3, down: 3 }, cousin_issu_germain: { up: 2, down: 3 },
        cousin_remue_germain: { up: 3, down: 3 }, cousin_breton: { up: 2, down: 3 }
    };
    const HYP_TERM_LABELS = {
        pere: "Père", mere: "Mère", beau_pere: "Beau-père", belle_mere: "Belle-mère", ayeul: "Ayeul", frere: "Frère", soeur: "Sœur",
        oncle: "Oncle", tante: "Tante", neveu_niece: "Neveu/Nièce",
        cousin_germain: "Cousin germain", cousin_issu_germain: "Cousin issu de germain",
        cousin_remue_germain: "Cousin remué/remis de germain", cousin_breton: "Cousin à la mode de Bretagne",
        canonique_compose: "Degré canonique composé", numerique_libre: "Degré numérique"
    };
    const HYP_DEGREE_WORDS = {
        un: 1, premier: 1, premiere: 1, "première": 1,
        deux: 2, second: 2, seconde: 2, deuxieme: 2, "deuxième": 2,
        tiers: 3, troisieme: 3, "troisième": 3,
        quart: 4, quatrieme: 4, "quatrième": 4, quartrieme: 4, "quartrième": 4,
        cinquieme: 5, "cinquième": 5, quint: 5, sixieme: 6, "sixième": 6,
        septieme: 7, "septième": 7, huitieme: 8, "huitième": 8,
        neuvieme: 9, "neuvième": 9, neufieme: 9, "neufième": 9, dixieme: 10, "dixième": 10
    };
    function hypParseDegreeNumber(text) {
        if (!text) return null;
        const numMatch = text.match(/(\d+)/);
        if (numMatch) return parseInt(numMatch[1], 10);
        const lower = text.toLowerCase();
        for (const word in HYP_DEGREE_WORDS) {
            if (new RegExp("\\b" + word + "\\b", "i").test(lower)) return HYP_DEGREE_WORDS[word];
        }
        return null;
    }
    // Civil : degré = up + down (ex. cousin germain = 4e degré). Canonique : degré = max(up, down)
    // (ex. cousin germain = 2e degré), calcul traditionnellement utilisé en droit canon.
    function hypGenerateCandidatesForDegree(n, mode) {
        const list = [];
        if (mode === "canonique") {
            for (let k = 1; k <= n; k++) { list.push({ up: n, down: k }); if (k !== n) list.push({ up: k, down: n }); }
        } else {
            for (let up = 1; up < n; up++) list.push({ up, down: n - up });
        }
        return list;
    }
    function hypBuildCandidatesFromForm() {
        const terme = document.getElementById("hypTerme").value;
        if (terme === "numerique_libre") {
            const word = document.getElementById("hypDegreeWord").value.trim();
            const mode = document.getElementById("hypDegreeMode").value;
            const n = hypParseDegreeNumber(word);
            if (!n) return null;
            return { candidates: hypGenerateCandidatesForDegree(n, mode), degreeWord: word, degreeMode: mode };
        }
        if (terme === "canonique_compose") {
            const raw = document.getElementById("hypCanoniqueCompose").value.trim();
            const parts = raw.split(/\bau\b/i);
            if (parts.length !== 2) return null;
            const a = hypParseDegreeNumber(parts[0].trim());
            const b = hypParseDegreeNumber(parts[1].trim());
            if (!a || !b) return null;
            const candidates = a === b ? [{ up: a, down: b }] : [{ up: a, down: b }, { up: b, down: a }];
            return { candidates, degreeWord: raw, degreeMode: "canonique" };
        }
        if (terme === "ayeul") {
            const candidates = [];
            for (let up = 1; up <= parseInt(hypMaxGenEl.value, 10); up++) candidates.push({ up, down: 0 });
            return { candidates };
        }
        if (terme === "pere" || terme === "mere" || terme === "beau_pere" || terme === "belle_mere") return { candidates: [{ up: 1, down: 0 }] };
        if (terme === "frere" || terme === "soeur") return { candidates: [{ up: 1, down: 1 }] };
        const entry = HYP_TERM_DICT[terme];
        if (!entry) return null;
        return { candidates: [{ up: entry.up, down: entry.down }] };
    }
    // Chaque candidat {up,down} de base est décliné selon la branche et la nature du lien : quand
    // l'une (ou les deux) est "indéterminée", on crée une variante indépendante par combinaison
    // possible (ex. cousin germain, branche ET nature non précisées -> 4 variantes), chacune
    // confirmable/rejetable séparément — ça réutilise directement le mécanisme déjà en place pour
    // l'ambiguïté de degré, plutôt que d'inventer un système parallèle.
    const HYP_BRANCHE_LABELS = { paternel: "paternelle", maternel: "maternelle", germain: "germaine", indetermine: "non précisée" };
    const HYP_NATURE_LABELS = { sang: "par le sang", alliance: "par alliance", indetermine: "non précisée" };
    function hypExpandVariants(baseCandidates, brancheChoice, natureChoice) {
        const branches = brancheChoice === "indetermine" ? ["paternel", "maternel"] : [brancheChoice];
        const natures = natureChoice === "indetermine" ? ["sang", "alliance"] : [natureChoice];
        const out = [];
        baseCandidates.forEach(c => {
            branches.forEach(branche => {
                natures.forEach(lienNature => out.push({ up: c.up, down: c.down, branche, lienNature, statut: "ouvert" }));
            });
        });
        return out;
    }
    function hypCandidateDesc(cand) {
        return `${HYP_BRANCHE_LABELS[cand.branche] || cand.branche}, ${HYP_NATURE_LABELS[cand.lienNature] || cand.lienNature}`;
    }
    function hypDescribeHyp(hyp) {
        let s = HYP_TERM_LABELS[hyp.terme] || hyp.terme;
        if ((hyp.terme === "frere" || hyp.terme === "soeur") && hyp.fratrieQualif) s += ` (${HYP_BRANCHE_LABELS[hyp.fratrieQualif] || hyp.fratrieQualif})`;
        if (hyp.terme === "numerique_libre") s += ` : ${hyp.degreeWord} (${hyp.degreeMode})`;
        if (hyp.terme === "canonique_compose") s += ` : ${hyp.degreeWord}`;
        s += ` — ${hyp.mode}`;
        return s;
    }
    function hypSubjectLabel(hyp) {
        const tags = [];
        if (hyp.veuf) tags.push(hyp.veuf);
        if (hyp.defunt) tags.push("défunt");
        return hyp.subject + (tags.length ? ` (${tags.join(", ")})` : "");
    }

    // --- DOM refs ---
    const hypStatusEl = document.getElementById("hypStatus");
    const hypPivotSearchEl = document.getElementById("hypPivotSearch");
    const hypPivotResultsEl = document.getElementById("hypPivotResults");
    const hypPivotSelectedEl = document.getElementById("hypPivotSelected");
    const hypRefSelect = document.getElementById("hypRef");
    const hypMaxGenEl = document.getElementById("hypMaxGen");
    const hypMaxGenValEl = document.getElementById("hypMaxGenVal");

    function hypApplyGedData(data) {
        hypGedData = data;
        const ids = Object.keys(hypGedData.individuals);
        hypStatusEl.textContent = ids.length
            ? `${ids.length} individu(s), ${Object.keys(hypGedData.families).length} famille(s) disponible(s).`
            : "Chargez un fichier GEDCOM depuis l'accueil (ou générez un scénario rapide).";
        hypPivotSearchEl.disabled = !ids.length;
        hypPivotId = ids.length ? (ids.includes('I1') ? 'I1' : ids[0]) : null;
        hypPivotSelectedEl.textContent = hypPivotId ? `→ ${hypGedData.individuals[hypPivotId].name}` : '';
        hypotheses = []; hypCounter = 0; hypManualPos = {}; hypLevelMult = {};
        hypRefreshRefOptions();
        hypRenderList();
        hypResetViewBox();
        hypRender();
    }

    document.getElementById("hypBtnQuickStart").addEventListener("click", () => {
        const ref = document.getElementById("hypQsChild").value.trim();
        const father = document.getElementById("hypQsFather").value.trim();
        const mother = document.getElementById("hypQsMother").value.trim();
        const siblings = document.getElementById("hypQsSiblings").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (!ref) { alert("Merci de renseigner au moins le nom de l'individu de référence."); return; }
        hypApplyGedData(buildQuickScenario(ref, father, mother, siblings));
    });

    hypPivotSearchEl.addEventListener("input", e => {
        const v = e.target.value.toLowerCase(); hypPivotResultsEl.innerHTML = '';
        if (v.length < 2) { hypPivotResultsEl.style.display = 'none'; return; }
        const matches = Object.values(hypGedData.individuals).filter(i => i.name.toLowerCase().includes(v)).slice(0, 10);
        if (matches.length) {
            hypPivotResultsEl.style.display = 'block';
            matches.forEach(p => {
                const li = document.createElement('li'); li.innerText = p.name;
                li.onclick = () => {
                    hypPivotId = p.id;
                    hypPivotSelectedEl.textContent = `→ ${p.name}`;
                    hypPivotResultsEl.style.display = 'none';
                    hypPivotSearchEl.value = '';
                    hypRefreshRefOptions();
                    hypRender();
                };
                hypPivotResultsEl.appendChild(li);
            });
        }
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.ctrl')) hypPivotResultsEl.style.display = 'none';
    });

    hypMaxGenEl.addEventListener("input", () => {
        hypMaxGenValEl.textContent = hypMaxGenEl.value;
        hypRefreshRefOptions();
        hypResetViewBox();
        hypRender();
    });

    // Chaque option pointe vers l'ID GEDCOM stable de la personne (pas vers une position relative
    // au pivot actuel) : une hypothèse déclarée "par rapport au père" reste attachée à CETTE
    // personne précise même si l'utilisateur change ensuite l'individu de référence affiché dans la
    // barre latérale — elle ne se "rattache" pas silencieusement à un autre père si le pivot change.
    function hypRefreshRefOptions() {
        hypRefSelect.innerHTML = "";
        if (!hypPivotId) return;
        const optPivot = document.createElement("option");
        optPivot.value = JSON.stringify({ indiId: hypPivotId });
        optPivot.textContent = `${hypGedData.individuals[hypPivotId].name} (individu de référence)`;
        hypRefSelect.appendChild(optPivot);
        const found = hypScanAscendants(hypPivotId, parseInt(hypMaxGenEl.value, 10));
        for (const f of found) {
            const opt = document.createElement("option");
            opt.value = JSON.stringify({ indiId: f.indi.id });
            const label = f.g === 1 ? (f.side === "paternel" ? "père" : "mère") : `gén. ${f.g}, ${f.side}`;
            opt.textContent = `${f.indi.name} (${label})`;
            hypRefSelect.appendChild(opt);
        }
        hypGetSiblings(hypPivotId).forEach(sib => {
            const opt = document.createElement("option");
            opt.value = JSON.stringify({ indiId: sib.id });
            opt.textContent = `${sib.name} (frère/sœur)`;
            hypRefSelect.appendChild(opt);
        });
        // On peut aussi énoncer une nouvelle hypothèse par rapport à une personne hypothétique déjà
        // CONFIRMÉE (pas un candidat encore ouvert : chaîner une supposition sur une autre
        // supposition non tranchée serait difficile à lire). Permet de construire une hypothèse pas
        // à pas (ex. confirmer un oncle, puis situer un cousin par rapport à cet oncle).
        hypotheses.forEach(hyp => {
            hyp.candidates.forEach((cand, cIdx) => {
                if (cand.statut !== "confirme") return;
                const opt = document.createElement("option");
                opt.value = JSON.stringify({ hypSubject: hyp.id, cIdx });
                opt.textContent = `${hypSubjectLabel(hyp)} (hypothèse confirmée)`;
                hypRefSelect.appendChild(opt);
            });
        });
    }

    // --- Formulaire d'hypothèse : affichage conditionnel ---
    const hypConjointBlockEl = document.getElementById("hypConjointBlock");
    const hypTermeEl = document.getElementById("hypTerme");
    const hypFratrieBlockEl = document.getElementById("hypFratrieBlock");
    const hypCanoniqueComposeBlockEl = document.getElementById("hypCanoniqueComposeBlock");
    const hypDegreLibreBlockEl = document.getElementById("hypDegreLibreBlock");
    const hypFratrieQualifEl = document.getElementById("hypFratrieQualif");
    const hypBrancheBlockEl = document.getElementById("hypBrancheBlock");
    const hypBrancheSelect = document.getElementById("hypBranche");
    const hypLienNatureEl = document.getElementById("hypLienNature");
    const hypParsePreviewEl = document.getElementById("hypParsePreview");

    // Pour frère/sœur, le champ "Lignage" (germain/paternel/maternel/indéterminé) remplace la
    // "Branche" générique (qui n'a pas d'option "germain" — bilatéral n'a de sens que pour une
    // fratrie) : on masque l'une pendant que l'autre pilote la branche effective de l'hypothèse.
    function hypBrancheChoice() {
        const terme = hypTermeEl.value;
        return (terme === "frere" || terme === "soeur") ? hypFratrieQualifEl.value : hypBrancheSelect.value;
    }
    function hypUpdateFormVisibility() {
        const terme = hypTermeEl.value;
        const isFratrie = (terme === "frere" || terme === "soeur");
        hypConjointBlockEl.style.display = (hypLienNatureEl.value === "alliance" || hypLienNatureEl.value === "indetermine") ? "flex" : "none";
        hypFratrieBlockEl.style.display = isFratrie ? "flex" : "none";
        hypBrancheBlockEl.style.display = isFratrie ? "none" : "block";
        hypCanoniqueComposeBlockEl.style.display = terme === "canonique_compose" ? "flex" : "none";
        hypDegreLibreBlockEl.style.display = terme === "numerique_libre" ? "flex" : "none";
    }
    hypLienNatureEl.addEventListener("change", hypUpdateFormVisibility);
    hypTermeEl.addEventListener("change", () => {
        hypUpdateFormVisibility();
        if (hypTermeEl.value === "pere") hypBrancheSelect.value = "paternel";
        if (hypTermeEl.value === "mere") hypBrancheSelect.value = "maternel";
        // Beau-père/belle-mère occupent la place du père/de la mère dans l'arbre (même branche),
        // mais ne sont jamais un lien par le sang : la nature "alliance" est donc forcée plutôt que
        // laissée au choix par défaut ("par le sang"), qui serait faux dans tous les cas.
        if (hypTermeEl.value === "beau_pere") { hypBrancheSelect.value = "paternel"; hypLienNatureEl.value = "alliance"; hypUpdateFormVisibility(); }
        if (hypTermeEl.value === "belle_mere") { hypBrancheSelect.value = "maternel"; hypLienNatureEl.value = "alliance"; hypUpdateFormVisibility(); }
        hypUpdatePreview();
    });
    hypFratrieQualifEl.addEventListener("change", hypUpdatePreview);
    hypBrancheSelect.addEventListener("change", hypUpdatePreview);
    document.getElementById("hypDegreeWord").addEventListener("input", hypUpdatePreview);
    document.getElementById("hypDegreeMode").addEventListener("change", hypUpdatePreview);
    document.getElementById("hypCanoniqueCompose").addEventListener("input", hypUpdatePreview);

    function hypUpdatePreview() {
        const built = hypBuildCandidatesFromForm();
        if (!built || !built.candidates.length) { hypParsePreviewEl.textContent = "Aucun candidat : vérifiez le degré saisi."; return; }
        const expanded = hypExpandVariants(built.candidates, hypBrancheChoice(), hypLienNatureEl.value);
        const desc = expanded.map(c => `(montée ${c.up}/descente ${c.down}, ${hypCandidateDesc(c)})`).join(", ");
        hypParsePreviewEl.textContent = `${expanded.length} candidat(s) : ${desc}`;
    }
    hypUpdateFormVisibility();
    hypUpdatePreview();

    document.getElementById("hypBtnAddHyp").addEventListener("click", () => {
        const subject = document.getElementById("hypSubject").value.trim();
        if (!subject) { alert("Merci d'indiquer le nom de la personne citée."); return; }
        const built = hypBuildCandidatesFromForm();
        if (!built || !built.candidates.length) { alert("Impossible de déterminer un degré valide pour cette hypothèse."); return; }

        const terme = hypTermeEl.value;
        const lienNature = hypLienNatureEl.value;
        const conjointDe = (lienNature === "alliance" || lienNature === "indetermine") ? document.getElementById("hypConjointDe").value.trim() : "";
        const veuf = document.getElementById("hypVeuf").value;
        const defunt = document.getElementById("hypDefunt").checked;
        const fratrieQualif = (terme === "frere" || terme === "soeur") ? hypFratrieQualifEl.value : "";
        const mode = document.getElementById("hypMode").value;
        const acte = document.getElementById("hypActe").value.trim();
        const acteYear = document.getElementById("hypActeYear").value.trim();
        const refValue = hypRefSelect.value;

        hypotheses.push({
            id: "h" + (++hypCounter),
            subject, conjointDe, veuf, defunt, terme, fratrieQualif,
            degreeWord: built.degreeWord || "", degreeMode: built.degreeMode || "",
            acte, acteYear: acteYear ? parseInt(acteYear, 10) : null, referenceKey: refValue, mode,
            candidates: hypExpandVariants(built.candidates, hypBrancheChoice(), lienNature)
        });

        document.getElementById("hypSubject").value = "";
        document.getElementById("hypConjointDe").value = "";
        document.getElementById("hypDegreeWord").value = "";
        document.getElementById("hypCanoniqueCompose").value = "";
        document.getElementById("hypActe").value = "";
        document.getElementById("hypActeYear").value = "";
        document.getElementById("hypDefunt").checked = false;
        hypRenderList();
        hypRefreshRefOptions();
        hypRender();
    });

    // --- Liste des hypothèses (panneau) ---
    const hypCardListEl = document.getElementById("hypCardList");
    function hypRenderList() {
        hypCardListEl.innerHTML = "";
        for (const hyp of hypotheses) {
            const card = document.createElement("div");
            card.className = "hyp-card";

            const subjectEl = document.createElement("div");
            subjectEl.className = "hyp-subject";
            subjectEl.textContent = hypSubjectLabel(hyp);
            card.appendChild(subjectEl);

            const metaEl = document.createElement("div");
            metaEl.className = "hyp-meta";
            // Quand la référence est un ascendant connu d'un côté donné (ou une hypothèse confirmée
            // sur une branche donnée), ce côté prime sur la branche déclarée des candidats (voir
            // hypRender) : le rendre visible ici évite toute surprise ("j'ai dit maternelle mais ça
            // s'affiche du côté paternel"), et c'est aussi l'un des indices qu'un futur calcul de
            // plausibilité pourrait exploiter (l'acte source concerne souvent un parent précis).
            const refSide = hypResolveReference(hyp.referenceKey).side;
            const refSideNote = refSide ? ` [branche déduite de la référence : ${HYP_BRANCHE_LABELS[refSide] || refSide}]` : '';
            metaEl.textContent = hypDescribeHyp(hyp) + refSideNote + (hyp.acteYear ? ` — vers ${hyp.acteYear}` : "") + (hyp.acte ? ` — ${hyp.acte}` : "");
            card.appendChild(metaEl);

            const candsEl = document.createElement("div");
            candsEl.className = "hyp-candidates";
            hyp.candidates.forEach((c, idx) => {
                const chip = document.createElement("span");
                chip.className = "hyp-cand-chip " + (c.statut === "confirme" ? "confirme" : c.statut === "rejete" ? "rejete" : "");
                const lbl = document.createElement("span");
                lbl.textContent = `↑${c.up}/↓${c.down} — ${hypCandidateDesc(c)}`;
                lbl.title = `montée ${c.up} / descente ${c.down}, ${hypCandidateDesc(c)}`;
                chip.appendChild(lbl);
                if (c.statut === "ouvert") {
                    const btnOk = document.createElement("button");
                    btnOk.className = "small"; btnOk.textContent = "✓";
                    btnOk.title = "Confirmer cette hypothèse";
                    btnOk.addEventListener("click", () => {
                        hyp.candidates.forEach((cc, i) => { cc.statut = i === idx ? "confirme" : "rejete"; });
                        hypRenderList(); hypRefreshRefOptions(); hypRender();
                    });
                    const btnNo = document.createElement("button");
                    btnNo.className = "small"; btnNo.textContent = "✕";
                    btnNo.title = "Rejeter cette hypothèse";
                    btnNo.addEventListener("click", () => { c.statut = "rejete"; hypRenderList(); hypRefreshRefOptions(); hypRender(); });
                    chip.appendChild(btnOk); chip.appendChild(btnNo);
                }
                candsEl.appendChild(chip);
            });
            card.appendChild(candsEl);

            const btnDel = document.createElement("button");
            btnDel.className = "small"; btnDel.textContent = "Supprimer l'hypothèse";
            btnDel.addEventListener("click", () => {
                hypotheses = hypotheses.filter(h => h.id !== hyp.id);
                hypRenderList(); hypRefreshRefOptions(); hypRender();
            });
            card.appendChild(btnDel);

            hypCardListEl.appendChild(card);
        }
    }

    // --- Export / import des hypothèses ---
    document.getElementById("hypBtnExport").addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(hypotheses, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "hypotheses.json";
        a.click();
        URL.revokeObjectURL(url);
    });
    document.getElementById("hypBtnImport").addEventListener("click", () => document.getElementById("hypImportInput").click());
    document.getElementById("hypImportInput").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (!Array.isArray(data)) throw new Error("format invalide");
                hypotheses = data;
                hypCounter = hypotheses.length;
                hypRenderList(); hypRender();
            } catch (err) { alert("Fichier JSON invalide : " + err.message); }
        };
        reader.readAsText(file);
    });

    // --- Rendu SVG ---
    const hypSvg = document.getElementById("hypCanvas");
    const HYP_V_SPACING = 95;
    const HYP_PIVOT_Y = 40;
    let hypVb = { x: -900, y: -480, w: 1800, h: 930 };
    let hypRenderBounds = null; // étendue de tous les nœuds dessinés lors du dernier rendu

    function hypResetViewBox() {
        const maxGenNow = parseInt(hypMaxGenEl.value, 10);
        const viewH = maxGenNow * HYP_V_SPACING + 550;
        hypVb = { x: -900, y: -(maxGenNow * HYP_V_SPACING + 100), w: 1800, h: viewH };
    }
    function hypUpdateBounds(x, y, r) {
        const mx = r + 50, my = r + 30; // marge pour le label sous le nœud
        if (x - mx < hypRenderBounds.minX) hypRenderBounds.minX = x - mx;
        if (x + mx > hypRenderBounds.maxX) hypRenderBounds.maxX = x + mx;
        if (y - my < hypRenderBounds.minY) hypRenderBounds.minY = y - my;
        if (y + my > hypRenderBounds.maxY) hypRenderBounds.maxY = y + my;
    }
    function hypSideSign(side) {
        if (side === "paternel") return -1;
        if (side === "maternel") return 1;
        return 0; // "germain" : bilatéral, centré
    }
    function hypClamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    // Multiplicateur cumulatif d'espacement horizontal : Ctrl+clic sur un nœud de génération L
    // modifie hypLevelMult[L], ce qui élargit/resserre automatiquement ce niveau et tous les
    // niveaux plus éloignés (le facteur de L reste dans le produit pour tout g >= L).
    function hypEffectiveSpacingScale(g) {
        if (g < 1) return 1;
        let s = 1;
        for (let k = 1; k <= g; k++) s *= (hypLevelMult[k] || 1);
        return s;
    }
    function hypRealSlotX(side, g, index) {
        const scale = hypEffectiveSpacingScale(g);
        return hypSideSign(side) * (90 + index * 30) * scale;
    }
    function hypGhostX(side, g, lane) {
        const scale = hypEffectiveSpacingScale(g);
        if (side === "germain") {
            const dir = (lane % 2 === 0) ? -1 : 1;
            return dir * (20 + Math.floor(lane / 2) * 40) * scale;
        }
        return hypSideSign(side) * (260 + lane * 46) * scale;
    }
    function hypGenY(g) { return HYP_PIVOT_Y - g * HYP_V_SPACING; }

    function hypSvgEl(tag, attrs) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        return el;
    }

    // --- Pan (fond) et drag (nœuds) ---
    let hypIsPanning = false;
    let hypPanStart = null;
    let hypDragNodeKey = null;
    let hypDragOffset = { x: 0, y: 0 };
    let hypDragFixedY = 0; // le glissement d'un nœud est contraint à l'horizontale

    function hypToSvgPoint(evt) {
        const pt = hypSvg.createSVGPoint();
        pt.x = evt.clientX; pt.y = evt.clientY;
        const ctm = hypSvg.getScreenCTM();
        if (!ctm) return { x: 0, y: 0 };
        const p = pt.matrixTransform(ctm.inverse());
        return { x: p.x, y: p.y };
    }

    hypSvg.addEventListener("mousedown", (e) => {
        if (e.target !== hypSvg) return;
        hypIsPanning = true;
        hypPanStart = { clientX: e.clientX, clientY: e.clientY, vbX: hypVb.x, vbY: hypVb.y };
    });
    window.addEventListener("mousemove", (e) => {
        if (hypIsPanning) {
            const rect = hypSvg.getBoundingClientRect();
            const scaleX = hypVb.w / rect.width, scaleY = hypVb.h / rect.height;
            hypVb.x = hypPanStart.vbX - (e.clientX - hypPanStart.clientX) * scaleX;
            hypVb.y = hypPanStart.vbY - (e.clientY - hypPanStart.clientY) * scaleY;
            hypSvg.setAttribute("viewBox", `${hypVb.x} ${hypVb.y} ${hypVb.w} ${hypVb.h}`);
        } else if (hypDragNodeKey) {
            const pt = hypToSvgPoint(e);
            hypManualPos[hypDragNodeKey] = { x: pt.x - hypDragOffset.x, y: hypDragFixedY };
            hypRender();
        }
    });
    window.addEventListener("mouseup", () => { hypIsPanning = false; hypDragNodeKey = null; });

    document.getElementById("hypBtnFitView").addEventListener("click", () => {
        if (!hypRenderBounds || hypRenderBounds.minX === Infinity) return;
        const w = Math.max(200, hypRenderBounds.maxX - hypRenderBounds.minX);
        const h = Math.max(200, hypRenderBounds.maxY - hypRenderBounds.minY);
        hypVb = { x: hypRenderBounds.minX, y: hypRenderBounds.minY, w, h };
        hypRender();
    });
    document.getElementById("hypBtnResetView").addEventListener("click", () => { hypResetViewBox(); hypRender(); });
    document.getElementById("hypBtnResetLayout").addEventListener("click", () => { hypManualPos = {}; hypLevelMult = {}; hypRender(); });

    function hypDrawNode(parent, x, y, label, opts) {
        opts = opts || {};
        if (hypRenderBounds) hypUpdateBounds(x, y, opts.r || 20);
        const g = hypSvgEl("g", { transform: `translate(${x},${y})` });
        const circle = hypSvgEl("circle", {
            r: opts.r || 20,
            fill: opts.fill || "#2c3140",
            stroke: opts.stroke || "#5a6070",
            "stroke-width": opts.strokeWidth || 1.5,
            "stroke-dasharray": opts.dashed ? "4,3" : "none",
            opacity: opts.opacity != null ? opts.opacity : 1
        });
        g.appendChild(circle);
        if (label) {
            const text = hypSvgEl("text", { y: (opts.r || 20) + 14, "text-anchor": "middle" });
            // Un style CSS global non scopé (prévu pour l'arbre éventail : "text { font-size:7px;
            // fill:#222; text-shadow:... }") gagne toujours sur les attributs de présentation SVG
            // comme ceux ci-dessus : on force donc taille/couleur via le style inline (qui gagne sur
            // n'importe quelle règle de feuille de style), sans quoi tous les libellés de cet onglet
            // s'afficheraient minuscules (7px) quelle que soit la taille demandée ici.
            text.style.fill = opts.textColor || "#222";
            text.style.fontSize = (opts.fontSize || 11) + "px";
            text.style.textShadow = "none";
            text.textContent = label;
            g.appendChild(text);
        }
        if (opts.title) {
            const title = hypSvgEl("title");
            title.textContent = opts.title;
            g.appendChild(title);
        }
        if (opts.nodeKey) {
            g.style.cursor = "grab";
            g.addEventListener("mousedown", (e) => {
                if (e.ctrlKey) return; // Ctrl+clic sert à l'espacement, pas au déplacement
                e.stopPropagation();
                const pt = hypToSvgPoint(e);
                hypDragNodeKey = opts.nodeKey;
                hypDragOffset = { x: pt.x - x, y: pt.y - y };
                hypDragFixedY = y;
            });
            g.addEventListener("click", (e) => {
                if (!e.ctrlKey || opts.gen == null || opts.gen < 1) return;
                e.stopPropagation();
                const factor = e.shiftKey ? 1 / 1.3 : 1.3;
                hypLevelMult[opts.gen] = hypClamp((hypLevelMult[opts.gen] || 1) * factor, 0.3, 4);
                hypRender();
            });
        }
        parent.appendChild(g);
        return g;
    }
    function hypDrawLine(parent, x1, y1, x2, y2, opts) {
        opts = opts || {};
        const line = hypSvgEl("line", {
            x1, y1, x2, y2,
            stroke: opts.stroke || "#5a6070",
            "stroke-width": opts.strokeWidth || 1.5,
            "stroke-dasharray": opts.dashed ? "5,4" : "none",
            opacity: opts.opacity != null ? opts.opacity : 1
        });
        parent.appendChild(line);
    }
    // referenceKey pointe vers l'ID GEDCOM stable d'une personne connue {indiId} (pivot, ascendant
    // ou frère/sœur), ou vers le candidat CONFIRMÉ d'une autre hypothèse {hypSubject,cIdx} — permet
    // de bâtir une hypothèse en plusieurs étapes (confirmer un oncle, puis situer un cousin par
    // rapport à lui). L'ancien format ("PIVOT" ou {side,g,index}, position relative au pivot plutôt
    // qu'ID de personne) reste lu en secours pour les hypothèses déjà exportées en JSON avant ce
    // changement, mais n'est plus produit par le formulaire.
    // knownPosById (rempli pendant hypRender) donne {x,y,gen,side} de chaque personne connue,
    // indexée par son ID plutôt que par sa position dans l'arbre du pivot ACTUEL : une référence par
    // ID reste donc attachée à la même personne même si l'utilisateur change ensuite l'individu de
    // référence affiché — au prix de ne plus être positionnable si cette personne n'est plus
    // atteignable depuis le nouveau pivot (repli sur le pivot, comme pour une référence introuvable).
    function hypResolveReference(referenceKey, knownPosById) {
        if (!referenceKey) return { offset: 0, side: null };
        if (referenceKey === "PIVOT") return { offset: 0, side: null }; // ancien format
        try {
            const ref = JSON.parse(referenceKey);
            if (ref.hypSubject) {
                const refHyp = hypotheses.find(h => h.id === ref.hypSubject);
                const cand = refHyp && refHyp.candidates[ref.cIdx];
                if (!refHyp || !cand) return { offset: 0, side: null };
                const refOfRef = hypResolveReference(refHyp.referenceKey, knownPosById);
                return { offset: refOfRef.offset + cand.up - cand.down, side: cand.branche === "germain" ? null : cand.branche };
            }
            if (ref.indiId) {
                if (knownPosById) {
                    const pos = knownPosById[ref.indiId];
                    return pos ? { offset: pos.gen, side: pos.side } : { offset: 0, side: null };
                }
                // Pas de knownPosById fourni (ex. appelé depuis la liste des hypothèses, hors rendu
                // du canevas) : un scan léger suffit, pas besoin de calculer de positions x/y.
                if (!hypPivotId || ref.indiId === hypPivotId) return { offset: 0, side: null };
                const found = hypScanAscendants(hypPivotId, parseInt(hypMaxGenEl.value, 10)).find(f => f.indi.id === ref.indiId);
                return found ? { offset: found.g, side: found.side } : { offset: 0, side: null };
            }
            return { offset: ref.g, side: ref.side }; // ancien format {side,g,index}
        } catch (e) { return { offset: 0, side: null }; }
    }
    // Position réelle (génération + coordonnées) de la personne de référence de l'hypothèse, pour
    // pouvoir relier le pivot à l'ancêtre commun hypothétique par une lignée théorique.
    // hypSubjectPositions (rempli pendant hypRender) donne la position déjà calculée du candidat
    // confirmé d'une autre hypothèse quand la référence en pointe une.
    function hypResolveReferencePos(referenceKey, knownPosById, pivotPos, hypSubjectPositions) {
        if (!referenceKey || referenceKey === "PIVOT") return { x: pivotPos.x, y: pivotPos.y, gen: 0 };
        try {
            const ref = JSON.parse(referenceKey);
            if (ref.hypSubject) {
                const nodeKey = "HS|" + ref.hypSubject + "|" + ref.cIdx;
                const pos = hypSubjectPositions[nodeKey];
                if (pos) return { x: pos.x, y: pos.y, gen: hypResolveReference(referenceKey, knownPosById).offset };
                return { x: pivotPos.x, y: pivotPos.y, gen: 0 };
            }
            if (ref.indiId) {
                const pos = knownPosById && knownPosById[ref.indiId];
                if (pos) return { x: pos.x, y: pos.y, gen: pos.gen };
            }
        } catch (e) { /* ignore */ }
        return { x: pivotPos.x, y: pivotPos.y, gen: 0 };
    }

    function hypRender() {
        hypSvg.innerHTML = "";
        hypSvg.setAttribute("viewBox", `${hypVb.x} ${hypVb.y} ${hypVb.w} ${hypVb.h}`);
        hypRenderBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        if (!hypPivotId) return;

        const linesLayer = hypSvgEl("g"); const nodesLayer = hypSvgEl("g");
        hypSvg.appendChild(linesLayer); hypSvg.appendChild(nodesLayer);
        // Position (x,y) du nœud "sujet" de chaque candidat, remplie au fil du rendu : permet à une
        // hypothèse de se référencer au candidat confirmé d'une autre (voir hypResolveReferencePos).
        // Ne fonctionne que si l'hypothèse référencée est traitée avant celle qui la référence
        // (ordre d'ajout normal en pratique : on confirme, puis on ajoute la suivante par rapport à elle).
        const hypSubjectPositions = {};

        const maxGenNow = parseInt(hypMaxGenEl.value, 10);
        const known = hypScanAscendants(hypPivotId, maxGenNow);
        const knownPos = {};
        for (const f of known) {
            const key = "K|" + f.side + "|" + f.g + "|" + f.index;
            let x = hypRealSlotX(f.side, f.g, f.index), y = hypGenY(f.g);
            if (hypManualPos[key]) { x = hypManualPos[key].x; y = hypManualPos[key].y; }
            knownPos[key] = { x, y, f };
        }

        let pivotPos = { x: 0, y: HYP_PIVOT_Y };
        if (hypManualPos.PIVOT) pivotPos = hypManualPos.PIVOT;

        // Position par ID GEDCOM stable (voir hypResolveReference/hypResolveReferencePos) : construite
        // à partir des mêmes ascendants connus, plus le pivot et ses frères/sœurs.
        const knownPosById = { [hypPivotId]: { x: pivotPos.x, y: pivotPos.y, gen: 0, side: null } };

        for (const key in knownPos) {
            const { x, y, f } = knownPos[key];
            const parentKey = f.g === 1 ? null : "K|" + f.side + "|" + (f.g - 1) + "|" + (f.index >> 1);
            const parentPos = f.g === 1 ? pivotPos : (knownPos[parentKey] || null);
            if (parentPos) {
                hypDrawLine(linesLayer, x, y, parentPos.x, parentPos.y, { stroke: f.side === "paternel" ? "#4f8fe0" : "#e05f8f" });
            }
            hypDrawNode(nodesLayer, x, y, f.indi.name, {
                fill: f.side === "paternel" ? "#dbe8fb" : "#fbdbe8",
                stroke: f.side === "paternel" ? "#4f8fe0" : "#e05f8f",
                title: `${f.indi.name} — génération ${f.g}, branche ${f.side}`,
                nodeKey: key, gen: f.g
            });
            knownPosById[f.indi.id] = { x, y, gen: f.g, side: f.side };
        }

        const pivotIndi = hypGedData.individuals[hypPivotId];
        hypDrawNode(nodesLayer, pivotPos.x, pivotPos.y, pivotIndi ? pivotIndi.name : "?", {
            r: 24, fill: "#3b82f6", stroke: "#1d4ed8", strokeWidth: 2, textColor: "#fff",
            title: `${pivotIndi ? pivotIndi.name : '?'} — individu de référence`, nodeKey: "PIVOT", gen: 0
        });

        // Frères et sœurs de l'individu de référence, affichés à côté de lui et reliés au(x)
        // parent(s) connu(s) (gén. 1) exactement comme il l'est lui-même.
        const fatherPos = knownPos["K|paternel|1|0"];
        const motherPos = knownPos["K|maternel|1|0"];
        hypGetSiblings(hypPivotId).forEach((sib, i) => {
            const sibKey = "SIB|" + sib.id;
            const sign = (i % 2 === 0) ? 1 : -1;
            const rank = Math.floor(i / 2) + 1;
            let sx = pivotPos.x + sign * rank * 70, sy = pivotPos.y;
            if (hypManualPos[sibKey]) { sx = hypManualPos[sibKey].x; sy = hypManualPos[sibKey].y; }
            if (fatherPos) hypDrawLine(linesLayer, sx, sy, fatherPos.x, fatherPos.y, { stroke: "#4f8fe0", opacity: 0.6 });
            if (motherPos) hypDrawLine(linesLayer, sx, sy, motherPos.x, motherPos.y, { stroke: "#e05f8f", opacity: 0.6 });
            hypDrawNode(nodesLayer, sx, sy, sib.name, {
                r: 18, fill: "#eef2f8", stroke: "#8898b0", strokeWidth: 1.5,
                title: `${sib.name} — frère/sœur de l'individu de référence`,
                nodeKey: sibKey, gen: 0
            });
            knownPosById[sib.id] = { x: sx, y: sy, gen: 0, side: null };
        });

        hypotheses.forEach((hyp, hIdx) => {
            const ref = hypResolveReference(hyp.referenceKey, knownPosById);
            hyp.candidates.forEach((cand, cIdx) => {
                if (cand.statut === "rejete") return;
                // Branche/nature vivent maintenant sur le candidat (pas l'hypothèse) : chaque
                // variante "non précisée" (paternel+maternel, sang+alliance...) se dessine et se
                // confirme/rejette indépendamment des autres. La référence, quand elle pointe vers
                // un ascendant connu d'un côté donné, prime sur la branche déclarée du candidat.
                const side = ref.side || cand.branche;
                const totalUp = ref.offset + cand.up;
                const confirmed = cand.statut === "confirme";
                const lane = hIdx * 3 + cIdx;
                const isAlliance = cand.lienNature === "alliance";

                const ghostKey = "HG|" + hyp.id + "|" + cIdx;
                let gx = hypGhostX(side, totalUp, lane), gy = hypGenY(totalUp);
                if (hypManualPos[ghostKey]) { gx = hypManualPos[ghostKey].x; gy = hypManualPos[ghostKey].y; }

                const refPos = hypResolveReferencePos(hyp.referenceKey, knownPosById, pivotPos, hypSubjectPositions);
                let prevPoint = { x: refPos.x, y: refPos.y };
                for (let g = refPos.gen + 1; g <= totalUp; g++) {
                    const isLast = g === totalUp;
                    let cx, cy;
                    if (isLast) { cx = gx; cy = gy; }
                    else {
                        const t = (g - refPos.gen) / (totalUp - refPos.gen);
                        cy = hypGenY(g);
                        cx = refPos.x + (gx - refPos.x) * t;
                        const chainKey = "HC|" + hyp.id + "|" + cIdx + "|" + g;
                        if (hypManualPos[chainKey]) cx = hypManualPos[chainKey].x;
                        hypDrawLine(linesLayer, prevPoint.x, prevPoint.y, cx, cy, {
                            stroke: confirmed ? "#27ae60" : "#c9a24f", dashed: !confirmed, opacity: confirmed ? 0.7 : 0.5
                        });
                        hypDrawNode(nodesLayer, cx, cy, "", {
                            r: 7, fill: "none", stroke: confirmed ? "#27ae60" : "#c9a24f",
                            dashed: !confirmed, opacity: confirmed ? 0.7 : 0.5,
                            title: `Ancêtre théorique — génération ${g}, ${hypCandidateDesc(cand)}`,
                            nodeKey: chainKey, gen: g
                        });
                        prevPoint = { x: cx, y: cy };
                        continue;
                    }
                    hypDrawLine(linesLayer, prevPoint.x, prevPoint.y, cx, cy, {
                        stroke: confirmed ? "#27ae60" : "#c9a24f", dashed: !confirmed, opacity: confirmed ? 0.7 : 0.5
                    });
                }

                const bloodKey = "HB|" + hyp.id + "|" + cIdx;
                let bx = gx + (hypSideSign(side) || 1) * 18, by = hypGenY(totalUp - cand.down);
                if (hypManualPos[bloodKey]) { bx = hypManualPos[bloodKey].x; by = hypManualPos[bloodKey].y; }

                hypDrawNode(nodesLayer, gx, gy, `ancêtre commun (gén. ${totalUp})`, {
                    r: 12, fill: "none", stroke: confirmed ? "#27ae60" : "#c9a24f",
                    dashed: !confirmed, fontSize: 9, opacity: confirmed ? 0.9 : 0.7,
                    title: `Position candidate : montée ${cand.up}, descente ${cand.down}, ${hypCandidateDesc(cand)}, ${hyp.mode}`,
                    nodeKey: ghostKey, gen: totalUp
                });

                // Descente théorique (ancêtre commun -> personne citée), symétrique de la montée
                // ci-dessus : un nœud par génération intermédiaire quand cand.down >= 2, au lieu
                // d'un unique trait direct qui sautait ces étapes.
                let descentOrigin = { x: gx, y: gy };
                for (let g = totalUp - 1; g > totalUp - cand.down; g--) {
                    const t = (totalUp - g) / cand.down;
                    const dy = hypGenY(g);
                    let dx = gx + (bx - gx) * t;
                    const descKey = "HD|" + hyp.id + "|" + cIdx + "|" + g;
                    if (hypManualPos[descKey]) dx = hypManualPos[descKey].x;
                    hypDrawLine(linesLayer, descentOrigin.x, descentOrigin.y, dx, dy, {
                        stroke: confirmed ? "#27ae60" : "#c9a24f", dashed: !confirmed, opacity: confirmed ? 0.7 : 0.5
                    });
                    hypDrawNode(nodesLayer, dx, dy, "", {
                        r: 7, fill: "none", stroke: confirmed ? "#27ae60" : "#c9a24f",
                        dashed: !confirmed, opacity: confirmed ? 0.7 : 0.5,
                        title: `Descendant théorique — génération ${g}, ${hypCandidateDesc(cand)}`,
                        nodeKey: descKey, gen: g
                    });
                    descentOrigin = { x: dx, y: dy };
                }

                if (isAlliance && hyp.conjointDe) {
                    hypDrawLine(linesLayer, descentOrigin.x, descentOrigin.y, bx, by, {
                        stroke: confirmed ? "#27ae60" : "#c9a24f", dashed: !confirmed, opacity: confirmed ? 0.9 : 0.7
                    });
                    hypDrawNode(nodesLayer, bx, by, hyp.conjointDe, {
                        r: 16, fill: confirmed ? "#dcf5e3" : "#faf1dc",
                        stroke: confirmed ? "#27ae60" : "#c9a24f",
                        dashed: !confirmed, opacity: confirmed ? 1 : 0.85,
                        title: `${hyp.conjointDe} — parent par le sang`,
                        nodeKey: bloodKey, gen: totalUp - cand.down
                    });

                    const spouseKey = "HS|" + hyp.id + "|" + cIdx;
                    let sx = bx + (hypSideSign(side) || 1) * 34, sy = by;
                    if (hypManualPos[spouseKey]) { sx = hypManualPos[spouseKey].x; sy = hypManualPos[spouseKey].y; }
                    hypSubjectPositions[spouseKey] = { x: sx, y: sy };
                    hypDrawLine(linesLayer, bx, by, sx, sy, { stroke: "#9b59b6", strokeWidth: 2, opacity: 0.9 });
                    hypDrawNode(nodesLayer, sx, sy, hypSubjectLabel(hyp), {
                        r: 14, fill: "#f1e6fa", stroke: "#9b59b6",
                        title: `${hyp.subject} — par alliance (conjoint de ${hyp.conjointDe})`,
                        nodeKey: spouseKey, gen: totalUp - cand.down
                    });
                } else {
                    // Variante "par alliance" sans conjoint(e) nommé(e) (issue d'une nature "non
                    // précisée" où l'on ne sait pas qui serait le parent par le sang) : on ne peut
                    // pas dessiner la chaîne ancêtre->conjoint nommé->sujet, donc rattachement
                    // direct comme pour une variante "par le sang", avec juste une note dans l'infobulle.
                    const subjKey = "HS|" + hyp.id + "|" + cIdx;
                    let sx = bx, sy = by;
                    if (hypManualPos[subjKey]) { sx = hypManualPos[subjKey].x; sy = hypManualPos[subjKey].y; }
                    hypSubjectPositions[subjKey] = { x: sx, y: sy };
                    hypDrawLine(linesLayer, descentOrigin.x, descentOrigin.y, sx, sy, {
                        stroke: confirmed ? "#27ae60" : "#c9a24f", dashed: !confirmed, opacity: confirmed ? 0.9 : 0.7
                    });
                    hypDrawNode(nodesLayer, sx, sy, hypSubjectLabel(hyp), {
                        r: 16,
                        fill: confirmed ? "#dcf5e3" : (isAlliance ? "#f1e6fa" : "#faf1dc"),
                        stroke: confirmed ? "#27ae60" : (isAlliance ? "#9b59b6" : "#c9a24f"),
                        dashed: !confirmed, opacity: confirmed ? 1 : 0.85,
                        title: `${hyp.subject} — ${hypDescribeHyp(hyp)}, ${hypCandidateDesc(cand)}`
                            + (isAlliance ? ' (alliance non exclue, conjoint non nommé)' : '')
                            + (hyp.acte ? ` (${hyp.acte})` : ""),
                        nodeKey: subjKey, gen: totalUp - cand.down
                    });
                }
            });
        });
    }

    // État initial (aucun fichier chargé pour l'instant)
    hypApplyGedData({ individuals: {}, families: {} });

    return {
        // Appelé par la page une fois le GEDCOM (ré)chargé depuis l'accueil.
        applyGedData(mapData, famsData) {
            hypApplyGedData(mapData.size ? buildHypGedDataFromApp(mapData, famsData) : { individuals: {}, families: {} });
        }
    };
}
