// ─────────────────────────────────────────────────────
//  FEATURE: Vessel Recommendation
//  Suggests up to 2 vessels near a "base date," computed
//  differently depending on which port is currently
//  highlighted by PortHighlighting:
//
//  Case 1 — highlighted port is SP001:
//    Base date = today.
//    If SP002's category is a DIFFERENT special category
//    (USA/Japan/EU_UK) than SP001's, restrict to FUTURE
//    vessels only (today → +7 days). Otherwise, allow both
//    past and future (today ±7 days).
//
//  Case 2 — highlighted port is anywhere else:
//    Base date = today − (stored DEPART diff of the port
//    row directly above the highlighted one, from
//    ScheduleCascade.diffs). Future only (base date →
//    base date +7 days), matching the original ">=" rule.
//
//  Both cases: at most 2 vessels, closest to the base date
//  first, each labeled Past/Today/Future.
//
//  Runs AUTOMATICALLY — on load, and whenever a port field,
//  the service field, or a vessel name/date field changes.
//  ALSO triggered directly by schedule-cascade.js right after
//  it stores fresh diffs (see the end of storeDiffs() there) —
//  that's a button click internal to that feature, not a field
//  change our own handle() would ever see otherwise, so without
//  that direct call Case 2 would only update after some unrelated
//  field edit happened to fire afterward.
// ─────────────────────────────────────────────────────
const VesselRecommendation = {

    WINDOW_DAYS:      7,
    MAX_SUGGESTIONS:  2,

    init() {
        this.suggest();
    },

    todayUTCMidnight() {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d;
    },

    suggest() {
        const highlightField = PortHighlighting.currentHighlightField;

        if (!highlightField) {
            setSuggestionBanner(null); // nothing to base a suggestion on yet — stay quiet, not noisy
            this.clearSuggestionHighlights();
            return;
        }

        const rowMatch = highlightField.name.match(/^SP(\d+)_port_name$/);
        if (!rowMatch) return;
        const rowNum = parseInt(rowMatch[1], 10);

        let baseDate;
        let futureOnly;

        if (rowNum === 1) {
            const port1Cat = PortHighlighting.getPortCategory(highlightField.value);
            const port2Field = document.querySelector('input[name="SP002_port_name"]');
            const port2Cat = port2Field ? PortHighlighting.getPortCategory(port2Field.value) : null;

            baseDate   = this.todayUTCMidnight();
            futureOnly = !!(port2Cat && port2Cat !== "OTHER" && port2Cat !== port1Cat);

            console.log(
                `⚓ Case 1: port1=${port1Cat}, port2=${port2Cat}, futureOnly=${futureOnly}, base=${DateUtils.format(baseDate)}`
            );
        } else {
            const aboveRow    = rowNum - 1;
            const aboveRowKey = String(aboveRow).padStart(3, "0");
            const diffEntry   = ScheduleCascade.diffs[aboveRowKey];

            if (!diffEntry) {
                // Quietly do nothing — this is expected until "Snapshot
                // Diffs" has been clicked at least once, and showing a
                // banner on every single keystroke until then would be
                // noisy rather than helpful.
                console.log(`⚓ No stored diff yet for SP${aboveRowKey} — waiting for Snapshot Diffs`);
                setSuggestionBanner(null);
                this.clearSuggestionHighlights();
                return;
            }

            baseDate   = DateUtils.addDays(this.todayUTCMidnight(), -diffEntry.depart);
            futureOnly = true;

            console.log(
                `⚓ Case 2: above row SP${aboveRowKey}, depart diff=${diffEntry.depart}, base=${DateUtils.format(baseDate)}`
            );
        }

        const windowStart = futureOnly ? baseDate : DateUtils.addDays(baseDate, -this.WINDOW_DAYS);
        const windowEnd    = DateUtils.addDays(baseDate, this.WINDOW_DAYS);

        const svFields = document.querySelectorAll(
            'input[name^="SV"][name$="_depart_date"]:not([name^="PV_"])'
        );

        const candidates = [];

        svFields.forEach(field => {
            const rowM = field.name.match(/^SV(\d+)_depart_date$/);
            if (!rowM) return;

            const vesselNameField = document.querySelector(`input[name="SV${rowM[1]}_vessel_name"]`);
            const vesselName = vesselNameField?.value.trim();
            if (!vesselName) return;

            const voyageField = document.querySelector(`input[name="SV${rowM[1]}_start_voyage"]`);
            const voyage = voyageField?.value.trim() || null;

            const date = DateUtils.parse(field.value);
            if (!date) return;

            if (date >= windowStart && date <= windowEnd) {
                const diffDays = Math.round((date - baseDate) / 86400000);
                candidates.push({ vesselName, vesselNameField, voyage, date, diffDays, absDiff: Math.abs(diffDays) });
            }
        });

        candidates.sort((a, b) => a.absDiff - b.absDiff);
        const top = candidates.slice(0, this.MAX_SUGGESTIONS);

        if (top.length === 0) {
            setSuggestionBanner(null); // nothing in range — quiet, not an alarming "no results" banner
            this.clearSuggestionHighlights();
            return;
        }

        // "Today" is only accurate when baseDate genuinely IS today's
        // real calendar date (Case 1). In Case 2, baseDate is a
        // CALCULATED target date (today minus a stored diff) — it's
        // often a different day entirely, so labeling an exact match
        // "Today" would be actively wrong, not just imprecise. The
        // base date itself is always shown in the title too, so
        // there's never ambiguity about what these labels are relative
        // to.
        const isBaseDateToday = baseDate.getTime() === this.todayUTCMidnight().getTime();

        const lines = top.map(c => {
            let label;
            if (c.diffDays < 0)      label = "Past";
            else if (c.diffDays > 0) label = "Future";
            else                     label = isBaseDateToday ? "Today" : "On base date";
            const voyagePart = c.voyage ? ` — ${c.voyage}` : "";
            return `${c.vesselName}${voyagePart} — ${label} (${DateUtils.format(c.date)})`;
        }).join("<br>");

        setSuggestionBanner({
            title:   `⚓ Suggested Vessel(s) — base ${DateUtils.format(baseDate)}`,
            message: lines
        });

        this.applySuggestionHighlights(top.map(c => c.vesselNameField));
    },

    SUGGESTION_HIGHLIGHT: {
        outline:         "2px solid #6e1e9e",
        backgroundColor: "#f0e6ff"
    },

    // Clears purple from every field this feature previously marked —
    // same safe "only touch what I flagged myself" pattern used
    // throughout (vessel-no-date.js, port-no-date.js, the basing-on
    // highlight in validation.js).
    clearSuggestionHighlights() {
        document.querySelectorAll('input[data-tt-suggested]').forEach(field => {
            field.style.outline = "";
            field.style.backgroundColor = "";
            delete field.dataset.ttSuggested;
        });
    },

    // Fill only in light mode — see port-highlighting.js's applyHighlight()
    // for why dark mode stays outline-only.
    applySuggestionHighlights(fields) {
        this.clearSuggestionHighlights();
        fields.forEach(field => {
            if (!field) return;
            field.style.outline         = this.SUGGESTION_HIGHLIGHT.outline;
            field.style.backgroundColor = TradetechStars.darkModeOn ? "" : this.SUGGESTION_HIGHLIGHT.backgroundColor;
            field.dataset.ttSuggested   = "1";
        });
    },

    handle(event) {
        const { name } = event.target;
        if (!name) return;

        const relevant =
            /^SP\d+_port_name$/.test(name)   ||
            /^SP\d+_port_code$/.test(name)   ||
            /^SV\d+_vessel_name$/.test(name) ||
            /^SV\d+_depart_date$/.test(name) ||
            name === "service"               ||
            /^first_(us|eu)_port(_desc)?$/.test(name);

        if (relevant) this.suggest();
    },

    handleBlur(_event) {}
};