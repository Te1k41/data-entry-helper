// ─────────────────────────────────────────────────────
//  FEATURE: Port Category Highlighting
//  Highlights the port row where the shipment's "region"
//  changes (e.g. leaving Asia and entering the USA).
//  Checks a priority list of Tradetech's own
//  first_us_port / first_eu_port fields first; falls back
//  to a generic scan of every port-to-port transition if
//  no priority match is found.
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

    // Reads the `service` field and checks whether it ends with a
    // compass direction suffix (-N/-S/-E/-W, case-insensitive). This
    // flag decides whether the scan below biases toward the FIRST
    // category-change candidate or the LAST one.
    isDirectionalService() {
        const serviceField = document.querySelector('input[type="text"][name="service"]');
        if (!serviceField) {
            console.warn("⚠ Service field not found — defaulting to non-directional");
            return false;
        }
        const isDirectional = /-[NSEW]$/i.test(serviceField.value.trim());
        console.log(`🧭 Service: "${serviceField.value}" → directional: ${isDirectional}`);
        return isDirectional;
    },

    applyHighlight(field) {
        field.style.outline          = this.HIGHLIGHT_STYLE.outline;
        field.style.backgroundColor  = this.HIGHLIGHT_STYLE.backgroundColor;
    },

    // Resets styling so re-running the scan doesn't leave stale
    // highlights on fields that are no longer the chosen one.
    clearAllHighlights(fields) {
        fields.forEach(f => {
            f.style.outline = "";
            f.style.backgroundColor = "";
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

        const biasFirst = this.isDirectionalService();

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
    },

    init() {
        this.run();
    },

    // Re-run the whole scan whenever a port name, port code, the
    // service field, or a first_us_port/first_eu_port field changes.
    handle(event) {
        const { name } = event.target;
        if (!name) return;

        const relevant =
            /^SP\d+_port_name$/.test(name) ||
            /^SP\d+_port_code$/.test(name) ||
            name === "service"             ||
            /^first_(us|eu)_port(_desc)?$/.test(name);

        if (relevant) this.run();
    }
};