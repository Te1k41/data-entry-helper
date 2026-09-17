// ─────────────────────────────────────────────────────
//  FEATURE: Port Category Highlighting
//  Highlights the port row where the shipment's "region"
//  changes (e.g. leaving Asia and entering the USA).
//  Checks a priority list of Tradetech's own
//  first_us_port / first_eu_port fields first; falls back
//  to a generic scan of every port-to-port transition if
//  no priority match is found.
//
//  A "full bound" service (no -N/-S/-E/-W suffix on the service
//  code) is really 2 legs run back-to-back. Tradetech marks the
//  pivot between them on whichever port row's SP*_port_key first
//  carries an End ("E") marker (e.g. SP003 = "EEWS": the East leg
//  ENDS here, the West leg STARTs here). Highlighting for that
//  kind of service is based on that row and everything after it,
//  the pivot acting as the effective SP001. See
//  findFullBoundPivotRow()/parsePortKeyDirections() below.
// ─────────────────────────────────────────────────────
const PortHighlighting = {

    // Country names that map to the EU_UK category. Needs manual
    // updates if EU membership ever changes.
    EU_COUNTRIES: new Set([
        "AUSTRIA", "BELGIUM", "BULGARIA", "CROATIA", "CYPRUS", "CZECH REPUBLIC",
        "DENMARK", "ESTONIA", "FINLAND", "FRANCE", "GERMANY", "GREECE", "HUNGARY",
        "IRELAND", "ITALY", "LATVIA", "LITHUANIA", "LUXEMBOURG", "MALTA",
        "NETHERLANDS", "POLAND", "PORTUGAL", "ROMANIA", "SLOVAKIA", "SLOVENIA",
        "SPAIN", "SWEDEN"
    ]),

    // Category rank — lower = higher priority. Used when multiple
    // valid category-change candidates exist on the same route.
    // Add or reorder entries here to change priority.
    //
    // NOTE: Canada does NOT get its own entry here. It's folded into
    // the "USA" category down in getPortCategory() below, so the two
    // are treated as a single region — crossing between a Canadian
    // port and a US port is never counted as a region change.
    CATEGORY_RANK: {
        USA: 1,
        JAPAN: 2, EU_UK: 2
    },

    // Priority port keys checked BEFORE the generic scan. Each key
    // corresponds to a Tradetech field named first_{key}_port.
    // Add more entries (e.g. "jp") if Tradetech adds new
    // first_xx_port fields.
    PRIORITY_PORT_KEYS: ["us", "eu"],

    // Highlight style — edit here to change appearance.
    HIGHLIGHT_STYLE: {
        outline: "2px solid #e67e00",
        backgroundColor: "#fff8e1"
    },

    // Classifies a port name string by checking what it ends with.
    // Returns "OTHER" for anything not recognized.
    //
    // Canada is intentionally classified as "USA" here (not its own
    // "CANADA" category). This means the US and Canada are one region
    // for highlighting purposes — whichever port appears first when
    // entering that region is the one that gets highlighted, and
    // continuing on into the other one afterward does not trigger a
    // second highlight.
    getPortCategory(portName) {
        if (!portName) return null;
        const name = portName.trim().toUpperCase();

        if (name.endsWith("USA"))            return "USA";
        if (name.endsWith("CANADA"))         return "USA"; // merged w/ USA — see note above
        if (name.endsWith("JAPAN"))          return "JAPAN";
        if (name.endsWith("JAP"))            return "JAPAN";
        if (name.endsWith("UNITED KINGDOM")) return "EU_UK";

        for (const country of this.EU_COUNTRIES) {
            if (name.endsWith(country)) return "EU_UK";
        }

        return "OTHER";
    },

    // Parses SP001_port_key into its Start/End compass directions.
    // Each 2-character chunk is [DIRECTION][S|E] — the letter is which
    // end of the route it marks, not the compass direction itself
    // (that's the first character). E.g. "NEES" is chunks "NE" (North,
    // End) + "ES" (East, Start): the route starts heading East and
    // ends heading North. A service can carry up to 2 such chunks (one
    // Start, one End) — a bare 2-character key names just one of them.
    // Returns null if the string doesn't cleanly parse as one or two
    // such chunks.
    parsePortKeyDirections(portKey) {
        const value = (portKey || "").trim().toUpperCase();
        if (!value || value.length % 2 !== 0 || value.length > 4) return null;

        const directions = {};
        for (let i = 0; i < value.length; i += 2) {
            const [compass, marker] = [value[i], value[i + 1]];
            if (!"NSEW".includes(compass) || !"SE".includes(marker)) return null;
            if (marker === "S") directions.start = compass;
            else directions.end = compass;
        }
        return (directions.start || directions.end) ? directions : null;
    },

    // Reads the `service` field and checks whether it ends with a
    // compass direction suffix (-N/-S/-E/-W, case-insensitive). This
    // flag decides whether the scan below biases toward the FIRST
    // category-change candidate or the LAST one.
    isDirectionalService() {
        const serviceField = document.querySelector('input[type="text"][name="service"]');
        const serviceValue = serviceField ? serviceField.value.trim() : "";
        const isDirectional = /-[NSEW]$/i.test(serviceValue);
        console.log(`🧭 Service: "${serviceValue}" → directional: ${isDirectional}`);
        return isDirectional;
    },

    // Full-bound service (no directional suffix): find the pivot row
    // where the first leg ends. Scans every SP*_port_key field in row
    // order and returns the row number of the first one whose value
    // parses with an End ("E") marker — e.g. SP001="ES" (East-Start,
    // no end, not a pivot), SP003="EEWS" (East-End + West-Start — this
    // IS the pivot). Returns null if no row carries an End marker
    // (route has no encoded 2nd leg).
    findFullBoundPivotRow() {
        const portKeyFields = Array.from(document.querySelectorAll(
            'input[type="text"][name^="SP"][name$="_port_key"]'
        ));

        for (const field of portKeyFields) {
            const match = field.name.match(/^SP(\d+)_port_key$/);
            if (!match) continue;
            const directions = this.parsePortKeyDirections(field.value);
            if (directions?.end) return parseInt(match[1], 10);
        }
        return null;
    },

    applyHighlight(field) {
        field.style.outline = this.HIGHLIGHT_STYLE.outline;
        field.style.backgroundColor = this.HIGHLIGHT_STYLE.backgroundColor;
        field.dataset.ttPortHighlightFlagged = "1";
    },

    // Resets styling so re-running the scan doesn't leave stale
    // highlights on fields that are no longer the chosen one. Only
    // ever clears fields THIS feature previously flagged (same
    // self-tagging convention port-no-date.js/validation.js/
    // vessel-recommendation.js already use) — confirmed real bug: a
    // blanket clear here was wiping DetectPortNoDate's red "missing
    // dates" highlight on unrelated rows any time a port_code/service/
    // first_xx_port field changed anywhere, since PortHighlighting
    // runs before DetectPortNoDate in main.js's FEATURES order and
    // both style the same SP*_port_name fields.
    clearAllHighlights(fields) {
        fields.forEach(f => {
            if (!f.dataset.ttPortHighlightFlagged) return;
            f.style.outline = "";
            f.style.backgroundColor = "";
            delete f.dataset.ttPortHighlightFlagged;
        });
    },

    run() {
        let portNameFields = Array.from(document.querySelectorAll(
            'input[type="text"][name^="SP"][name$="_port_name"]'
        ));

        this.clearAllHighlights(portNameFields);

        // Restrict the scan to rows within the sync boundary — ignores
        // the repeated "return leg" ports on a looping route.
        const stopRow = PortSyncBoundary.getStopRow();
        if (stopRow) {
            portNameFields = portNameFields.filter(f => {
                const match = f.name.match(/^SP(\d+)_port_name$/);
                if (!match) return true;
                return parseInt(match[1], 10) <= stopRow;
            });
            console.log(`🔁 Scan limited to ${portNameFields.length} ports (boundary at SP${String(stopRow).padStart(3, "0")})`);
        }

        // Full-bound service (no suffix) — restrict the scan to the
        // pivot row and everything after it, same idea as stopRow but
        // as a LOWER bound. The pivot's own leg (leg 2) is itself a
        // one-way run, so treat it as directional too once found.
        const suffixDirectional = this.isDirectionalService();
        const pivotRow = suffixDirectional ? null : this.findFullBoundPivotRow();

        if (pivotRow) {
            portNameFields = portNameFields.filter(f => {
                const match = f.name.match(/^SP(\d+)_port_name$/);
                if (!match) return true;
                return parseInt(match[1], 10) >= pivotRow;
            });
            console.log(`🔁 Full-bound pivot at SP${String(pivotRow).padStart(3, "0")} — scan restricted to ${portNameFields.length} port(s) from there down`);
        }

        const biasFirst = suffixDirectional || !!pivotRow;

        // If directional and the first port repeats exactly at the
        // very last row, exclude that last row from the candidate scan
        // — that repeat is just the loop closing, not a real region change.
        if (biasFirst && stopRow) {
            const rowsWithContent = new Set();

            document.querySelectorAll(
                'input[name^="SP"][name$="_port_code"]:not([name^="PV_"]),' +
                'input[name^="SP"][name$="_port_name"]:not([name^="PV_"])'
            ).forEach(f => {
                const match = f.name.match(/^SP(\d+)_port_(code|name)$/);
                if (match && f.value.trim()) rowsWithContent.add(parseInt(match[1], 10));
            });

            const lastRow = rowsWithContent.size > 0 ? Math.max(...rowsWithContent) : null;

            if (lastRow !== null && stopRow === lastRow) {
                console.log(`🔁 First port repeats at last row SP${String(lastRow).padStart(3, "0")} — excluding from scan`);
                portNameFields = portNameFields.slice(0, -1);
            }
        }

        // ── Priority pass: check first_us_port / first_eu_port fields first ──
        for (const key of this.PRIORITY_PORT_KEYS) {
    const codeField = document.querySelector(`input[name="first_${key}_port"]`);
    if (!codeField) { console.log(`  (no first_${key}_port on page)`); continue; }

    const code = codeField.value.trim().toUpperCase();
    if (!code) continue;

    // Find the SP row whose port_code matches this priority code.
    const matchingCodeField = Array.from(
        document.querySelectorAll('input[name^="SP"][name$="_port_code"]:not([name^="PV_"])')
    ).find(f => {
        const match = f.name.match(/^SP(\d+)_port_code$/);
        if (!match) return false;
        const row = parseInt(match[1], 10);
        if (stopRow && row > stopRow) return false;
        if (pivotRow && row < pivotRow) return false;
        return f.value.trim().toUpperCase() === code;
    });

    if (!matchingCodeField) { 
        console.log(`  ⚠ no match for first_${key}_port code "${code}"`); 
        continue; 
    }

    const rowMatch = matchingCodeField.name.match(/^SP(\d+)_port_code$/);
    const rowNum   = parseInt(rowMatch[1], 10);

    // Get this row's port_name field.
    const targetField = document.querySelector(
        `input[name="SP${rowNum}_port_name"]`
    );

    if (!targetField) continue;

    // Get the port_name field directly above this row (for comparison).
    // NOTE: portNameFields is sorted ascending by row, so the row
    // truly adjacent to rowNum is the LAST one with row < rowNum —
    // not the FIRST one (which would always be SP001, regardless of
    // reordering, deletions, or re-adding a port at a new row number).
    const aboveField = portNameFields
        .filter(f => {
            const match = f.name.match(/^SP(\d+)_port_name$/);
            return match && parseInt(match[1], 10) < rowNum;
        })
        .pop();

    if (!aboveField || !aboveField.value.trim()) {
        console.log(`  ⚠ no port above SP${rowNum} — skipping priority highlight`);
        continue;
    }

    const currentCat = this.getPortCategory(targetField.value);
    const aboveCat   = this.getPortCategory(aboveField.value);

    console.log(`  first_${key}_port: SP${rowNum} is ${currentCat}, above is ${aboveCat}`);

    // Only highlight if it's a genuine category entry (not OTHER,
    // and not the same category as the row above it — this is also
    // what makes a Canada→USA (or USA→Canada) step a non-event, since
    // both resolve to the same "USA" category).
    if (currentCat === "OTHER" || currentCat === aboveCat) {
        console.log(`  ⚠ not a valid entry transition — skipping`);
        continue;
    }

    this.applyHighlight(targetField);
    console.log(`🟡 Priority match: SP${rowNum}_port_name via first_${key}_port`);
    return; // priority match found — skip the generic scan entirely
    }

        if (portNameFields.length === 0) {
            console.warn("⚠ No SP*_port_name fields found");
            return;
        }

        // ── Generic scan: collect every valid category-change candidate ──
        // Because Canada and USA share one category, this loop naturally
        // highlights whichever of the two is entered FIRST (Canada, in a
        // route like HKG → CANADA → USA) since the row immediately after
        // it shares the same category and is skipped as "not a change."
        const candidates = [];
        console.log(`🔎 Scanning ${portNameFields.length} ports, bias: ${biasFirst ? "FIRST" : "LAST"}`);

        for (let i = 1; i < portNameFields.length; i++) {
            const current = portNameFields[i];
            const above   = portNameFields[i - 1];

            if (!current.value.trim() || !above.value.trim()) continue;

            const currentCat = this.getPortCategory(current.value);
            const aboveCat   = this.getPortCategory(above.value);

            if (currentCat === "OTHER") continue; // leaving a category never counts
            if (currentCat !== aboveCat) {
                candidates.push({
                    field: current,
                    category: currentCat,
                    rank: this.CATEGORY_RANK[currentCat]
                });
            }
        }

        let highlightField = null;

        if (candidates.length > 0) {
            // Pick the best-ranked category; if several candidates tie
            // for best rank, pick first or last depending on direction.
            const bestRank     = Math.min(...candidates.map(c => c.rank));
            const topCandidates = candidates.filter(c => c.rank === bestRank);
            const chosen = biasFirst ? topCandidates[0] : topCandidates[topCandidates.length - 1];
            highlightField = chosen.field;
            console.log(`🏆 Chosen: ${highlightField.name}`);
        }

        // Fallback: always highlight something — default to SP001.
        if (!highlightField) highlightField = portNameFields[0];

        if (highlightField) this.applyHighlight(highlightField);
        console.log(`🟡 Highlighted: ${highlightField?.name} (${highlightField?.value})`);

        // Exposed so other features (e.g. vessel recommendation) can
        // know which port is currently highlighted without re-running
        // this whole scan themselves.
        this.currentHighlightField = highlightField || null;
    },

    init() {
        this.run();
    },

    // Re-run the whole scan whenever a port name, port code, the
    // service field, or a first_us_port/first_eu_port field changes.
    //
    // Port CODE changes get a follow-up: Tradetech's own page
    // auto-fills the matching port NAME field via an async lookup
    // after you type/change a code, and does so by setting .value
    // directly — no real "change" event fires for that, so we'd never
    // hear about it otherwise. Instead of guessing a delay, we poll
    // that specific row's name field until it actually has a value
    // (or we give up), then re-scan.
    handle(event) {
        const { name } = event.target;
        if (!name) return;

        const relevant =
            /^SP\d+_port_name$/.test(name) ||
            /^SP\d+_port_code$/.test(name) ||
            name === "service"             ||
            /^SP\d+_port_key$/.test(name)  || // drives findFullBoundPivotRow() for full-bound services
            /^first_(us|eu)_port(_desc)?$/.test(name);

        if (!relevant) return;

        this.run();

        const codeMatch = name.match(/^SP(\d+)_port_code$/);
        if (codeMatch) this.waitForNameThenRescan(codeMatch[1]);
    },

    // Polls SP{row}_port_name every 100ms (up to 5s) until it has a
    // non-empty value, then re-runs the scan. If the code field was
    // cleared (no code entered), there's nothing to wait for and this
    // exits immediately.
    waitForNameThenRescan(row) {
        clearInterval(this._recheckTimer);

        const codeField = document.querySelector(`input[name="SP${row}_port_code"]`);
        if (!codeField || !codeField.value.trim()) return;

        const nameField = document.querySelector(`input[name="SP${row}_port_name"]`);
        if (!nameField) return;

        let attempts = 0;
        const maxAttempts = 50; // 50 × 100ms = 5s ceiling

        this._recheckTimer = setInterval(() => {
            attempts++;

            if (nameField.value.trim()) {
                clearInterval(this._recheckTimer);
                console.log(`✅ SP${row}_port_name populated ("${nameField.value.trim()}") — rescanning`);
                this.run();
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(this._recheckTimer);
                console.warn(`⚠ SP${row}_port_name still empty after 5s — giving up on rescan`);
            }
        }, 100);
    }
};