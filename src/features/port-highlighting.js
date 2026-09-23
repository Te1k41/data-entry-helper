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

    // Finer split than getPortCategory() — used ONLY as a fallback (see
    // findFineCategoryHighlight() below) for a route that never leaves
    // one broad category, so the normal region-change scan finds
    // nothing at all (e.g. every port is EU/UK, or every port is
    // USA/Canada). Splits UK back out of EU_UK and Canada back out of
    // USA; returns null for Japan/Other, which have no finer split to
    // fall back on — those routes keep hitting the hard SP001 fallback,
    // same as before this existed.
    getFineCategory(portName) {
        if (!portName) return null;
        const name = portName.trim().toUpperCase();

        if (name.endsWith("UNITED KINGDOM")) return "UK";
        if (name.endsWith("CANADA"))         return "CANADA";

        const coarse = this.getPortCategory(portName);
        if (coarse === "EU_UK") return "EU";
        if (coarse === "USA")   return "USA";
        return null;
    },

    // Same consecutive-pair scan shape as the generic pass inside
    // findHighlightInWindow(), just keyed off getFineCategory() instead
    // of getPortCategory(). Only ever allowed to fire when the WHOLE
    // window is a single coarse category (all EU_UK, or all USA) — a
    // full-bound (pivot) route can reach here with leg1 individually
    // flat-EU and leg2 individually flat-USA (each leg's own scan found
    // nothing), but the combined window isn't "all EU" or "all USA" at
    // all, and the leg boundary itself is a real coarse-level region
    // change that just wasn't leg2's/leg1's own problem to catch —
    // never something this finer UK/Canada split should touch.
    //
    // UK/Canada play the exact same role here that "OTHER" plays in the
    // generic scan above — e.g. a EU/EU/EU/ASIA/EU/EU/EU route highlights
    // the EU port right after Asia (`current === "OTHER"` is skipped,
    // re-entering EU_UK counts). Same here: entering UK/Canada never
    // counts (`current` IS the special category — skipped), but the
    // plain EU/USA port you land back on right after leaving UK/Canada
    // does — never the UK/Canada row itself.
    //
    // Always the LAST such crossing when more than one exists, never the
    // first — unlike the rest of this file's biasFirst convention. The
    // point of this whole fallback is to say where the service is
    // actually going, so the most recent UK/Canada->EU/USA return is the
    // one that matters, not the earliest.
    findFineCategoryHighlight(fields) {
        const coarseCats = new Set(
            fields.map(f => f.value.trim() ? this.getPortCategory(f.value) : null).filter(Boolean)
        );
        const onlyCoarseCat = coarseCats.size === 1 ? [...coarseCats][0] : null;
        if (onlyCoarseCat !== "EU_UK" && onlyCoarseCat !== "USA") return null;

        const isSpecial = fine => fine === "UK" || fine === "CANADA";
        const candidates = [];

        for (let i = 1; i < fields.length; i++) {
            const current = fields[i];
            const above   = fields[i - 1];
            if (!current.value.trim() || !above.value.trim()) continue;

            const currentFine = this.getFineCategory(current.value);
            const aboveFine   = this.getFineCategory(above.value);
            if (!currentFine || !aboveFine) continue;
            if (isSpecial(currentFine)) continue; // entering UK/Canada never counts, same as OTHER
            if (currentFine !== aboveFine) candidates.push(current);
        }

        if (!candidates.length) return null;
        return candidates[candidates.length - 1];
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
    // trailing letter suffix (-A through -Z, case-insensitive — not just
    // compass N/S/E/W, since services also use plain string letters like
    // "-A"/"-B" for the same "loops back to its own start" naming). This
    // flag decides whether the scan below biases toward the FIRST
    // category-change candidate or the LAST one.
    isDirectionalService() {
        const serviceField = document.querySelector('input[type="text"][name="service"]');
        const serviceValue = serviceField ? serviceField.value.trim() : "";
        const isDirectional = /-[A-Z]$/i.test(serviceValue);
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

    // Leg 2 has its own End marker too, same as the pivot row's End
    // marker marks where leg 1 stopped. E.g. pivot SP004="EEWS" (West
    // leg starts here) — leg 2's own end shows up later as a row whose
    // key ends with West too, e.g. SP008="WE" (West-End). Scans
    // forward FROM the pivot for the first row whose port_key carries
    // an End marker for that SAME compass letter. Returns null if none
    // found (leg 2's scan window then stays unbounded except by the
    // ordinary sync boundary, same as before this existed).
    findLegEndRow(fromRow, compass) {
        const portKeyFields = Array.from(document.querySelectorAll(
            'input[type="text"][name^="SP"][name$="_port_key"]'
        ));

        for (const field of portKeyFields) {
            const match = field.name.match(/^SP(\d+)_port_key$/);
            if (!match) continue;
            const row = parseInt(match[1], 10);
            if (row < fromRow) continue;
            const directions = this.parsePortKeyDirections(field.value);
            if (directions?.end === compass) return row;
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

    // Finds the highlight target within one ordered slice of
    // SP*_port_name fields — shared by run() for both the whole-route
    // scan (no pivot) and each leg's own scan (full-bound, pivot
    // found). Tries the first_us_port/first_eu_port priority fields
    // first (bounded to rows actually inside this window), then falls
    // back to a generic category-change scan. Returns the chosen
    // field, or null if nothing in this window qualifies (caller
    // decides what "nothing found" means — a 2nd leg to check, or the
    // SP001 fallback).
    //
    // `precedingField`, when given, is the real port immediately
    // before fields[0] in the WHOLE route (not part of this window,
    // never itself a candidate) — used only so fields[0] can be
    // evaluated as a genuine category-change entry. Without this, a
    // window's own first row can NEVER be flagged (nothing to compare
    // it against), which is wrong for a full-bound route's pivot row:
    // confirmed live — a pivot row that itself was the first US port
    // (Los Angeles) was invisible to leg 2's scan for exactly this
    // reason, so the whole thing fell through to leg 1, then all the
    // way back to true SP001 (Singapore) — the wrong port entirely.
    findHighlightInWindow(fields, biasFirst, precedingField = null) {
        if (fields.length === 0) return null;

        const rowOf = f => parseInt(f.name.match(/^SP(\d+)_port_name$/)[1], 10);
        const rows = fields.map(rowOf);
        const minRow = Math.min(...rows);
        const maxRow = Math.max(...rows);

        // ── Priority pass ──
        for (const key of this.PRIORITY_PORT_KEYS) {
            const codeField = document.querySelector(`input[name="first_${key}_port"]`);
            if (!codeField) continue;

            const code = codeField.value.trim().toUpperCase();
            if (!code) continue;

            const matchingCodeField = Array.from(
                document.querySelectorAll('input[name^="SP"][name$="_port_code"]:not([name^="PV_"])')
            ).find(f => {
                const match = f.name.match(/^SP(\d+)_port_code$/);
                if (!match) return false;
                const row = parseInt(match[1], 10);
                if (row < minRow || row > maxRow) return false;
                return f.value.trim().toUpperCase() === code;
            });

            if (!matchingCodeField) {
                console.log(`  ⚠ no match for first_${key}_port code "${code}" in this window`);
                continue;
            }

            const rowMatch  = matchingCodeField.name.match(/^SP(\d+)_port_code$/);
            const rowNum    = parseInt(rowMatch[1], 10);
            const targetField = document.querySelector(`input[name="SP${rowNum}_port_name"]`);
            if (!targetField) continue;

            // "Above" means previous in THIS window's own order, not
            // previous row number — a leg's window can start mid-route.
            // Falls back to precedingField when the match IS fields[0].
            const targetIndex = fields.indexOf(targetField);
            const aboveField  = targetIndex > 0 ? fields[targetIndex - 1] : precedingField;

            if (!aboveField || !aboveField.value.trim()) {
                console.log(`  ⚠ no port above SP${rowNum} in this window — skipping priority highlight`);
                continue;
            }

            const currentCat = this.getPortCategory(targetField.value);
            const aboveCat   = this.getPortCategory(aboveField.value);

            console.log(`  first_${key}_port: SP${rowNum} is ${currentCat}, above is ${aboveCat}`);

            if (currentCat === "OTHER" || currentCat === aboveCat) {
                console.log(`  ⚠ not a valid entry transition — skipping`);
                continue;
            }

            console.log(`🟡 Priority match: SP${rowNum}_port_name via first_${key}_port`);
            return targetField;
        }

        // ── Generic scan: collect every valid category-change candidate ──
        // Because Canada and USA share one category, this loop naturally
        // highlights whichever of the two is entered FIRST (Canada, in a
        // route like HKG → CANADA → USA) since the row immediately after
        // it shares the same category and is skipped as "not a change."
        const candidates = [];
        console.log(`🔎 Scanning ${fields.length} ports, bias: ${biasFirst ? "FIRST" : "LAST"}`);

        for (let i = 0; i < fields.length; i++) {
            const current = fields[i];
            const above   = i > 0 ? fields[i - 1] : precedingField;

            if (!current.value.trim() || !above?.value.trim()) continue;

            const currentCat = this.getPortCategory(current.value);
            const aboveCat   = this.getPortCategory(above.value);

            if (currentCat === "OTHER") continue; // leaving a category never counts
            if (currentCat !== aboveCat) {
                candidates.push({ field: current, rank: this.CATEGORY_RANK[currentCat] });
            }
        }

        if (candidates.length === 0) return null;

        // Best-ranked category wins; ties broken by direction.
        const bestRank      = Math.min(...candidates.map(c => c.rank));
        const topCandidates = candidates.filter(c => c.rank === bestRank);
        const chosen = biasFirst ? topCandidates[0] : topCandidates[topCandidates.length - 1];
        console.log(`🏆 Chosen: ${chosen.field.name}`);
        return chosen.field;
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

        if (portNameFields.length === 0) {
            console.warn("⚠ No SP*_port_name fields found");
            this.currentHighlightField = null;
            this.hasSpecialPort = false; // stale true from a previous run would wrongly pass the "special only" filter
            return;
        }

        // Full-bound service (no suffix) = 2 legs run back-to-back.
        // Tradetech marks the pivot between them on whichever port
        // row's SP*_port_key first carries an End ("E") marker. Leg 2
        // is checked first and wins outright if it has any special
        // port — leg 1 is only ever used as a fallback when leg 2 has
        // nothing. Confirmed against a real route (Kaohsiung/Ningbo/
        // Nagoya/Tokyo/Tacoma-USA/Vancouver-Canada/Tokyo/Kobe/Nagoya/
        // Kaohsiung/Ningbo) where merging both legs into one shared
        // rank contest let leg 1's Tacoma silently outrank the correct
        // leg-2 answer (Tokyo) — they must be scanned as 2 separate,
        // ranked attempts, not one combined candidate pool.
        const suffixDirectional = this.isDirectionalService();
        const pivotRow = suffixDirectional ? null : this.findFullBoundPivotRow();
        const biasFirst = suffixDirectional || !!pivotRow;

        // Directional services (e.g. "SVC-E") loop back to the exact
        // port they started from — the last populated port row is
        // always that repeat, by definition of the service naming,
        // regardless of whether its port_code text happens to match the
        // first row's (might not be filled in yet, or formatted
        // differently). Always excluded so it can never count as a fake
        // region-change candidate. Scoped to suffixDirectional only, not
        // the broader biasFirst — a full-bound/pivot route isn't a
        // same-origin loop and shouldn't have its last row dropped.
        if (suffixDirectional && portNameFields.length > 1) {
            const rowOf = f => parseInt(f.name.match(/^SP(\d+)_port_name$/)[1], 10);

            // Blank spare rows further down the page (they always exist —
            // see insert-port.js) are still in portNameFields whenever
            // stopRow above came back null (port codes not typed yet,
            // formatting mismatch, etc.) — Math.max over ALL of them would
            // pick one of those blanks instead of the real last port,
            // making this exclusion silently do nothing in exactly the
            // case it exists for. Only ever look at rows with content.
            const filledRows = portNameFields.filter(f => f.value.trim()).map(rowOf);
            if (filledRows.length > 1) {
                const lastRow = Math.max(...filledRows);
                console.log(`🔁 Directional service — excluding last port row SP${String(lastRow).padStart(3, "0")} (same as first)`);
                portNameFields = portNameFields.filter(f => rowOf(f) !== lastRow);
            }
        }

        // Only ever ONE port highlighted. Leg 2 is superior — if it
        // has its own special port, that's the answer, full stop, even
        // when leg 1 also has one (e.g. Tacoma/USA in leg 1 never wins
        // over Tokyo/Japan in leg 2). Leg 1's hit is only ever used
        // when leg 2 comes up empty.
        let highlightField = null;

        if (pivotRow) {
            const rowOf = f => parseInt(f.name.match(/^SP(\d+)_port_name$/)[1], 10);
            let leg2Fields = portNameFields.filter(f => rowOf(f) >= pivotRow);
            const leg1Fields = portNameFields.filter(f => rowOf(f) <  pivotRow);

            // Leg 2 has its own End marker too (e.g. pivot SP004="EEWS"
            // starts the West leg; SP008="WE" ends it) — stop leg 2's
            // scan window there instead of letting it run all the way
            // to the unrelated sync boundary.
            const pivotKeyField = document.querySelector(`input[name="SP${pivotRow}_port_key"]`);
            const pivotDirections = this.parsePortKeyDirections(pivotKeyField?.value);
            if (pivotDirections?.start) {
                const leg2EndRow = this.findLegEndRow(pivotRow, pivotDirections.start);
                if (leg2EndRow) {
                    leg2Fields = leg2Fields.filter(f => rowOf(f) <= leg2EndRow);
                    console.log(`🔁 Leg 2 bounded to SP${String(leg2EndRow).padStart(3, "0")} (own End marker)`);
                }
            }

            // The pivot row itself (leg2Fields[0]) needs to be checked
            // against the real port right before it — leg1's last row
            // — not left uncheckable just because it's window-first.
            const precedingField = leg1Fields[leg1Fields.length - 1] || null;

            highlightField = this.findHighlightInWindow(leg2Fields, true, precedingField)
                || this.findHighlightInWindow(leg1Fields, true);
        } else {
            highlightField = this.findHighlightInWindow(portNameFields, biasFirst);
        }

        // Nothing found at all (route never leaves one broad category —
        // see getFineCategory()'s header comment) — try the finer UK/EU
        // or Canada/USA split before giving up and defaulting to SP001.
        // `isSpecialFind` tracks whether highlightField is a genuine
        // region-change/UK-Canada find, as opposed to the hard SP001
        // fallback with nothing actually notable about the route —
        // consumers that only care about a real find (e.g. the batch
        // Rotation Receipt Capture feature's "only special routes"
        // filter) check hasSpecialPort below instead of just truthiness
        // of currentHighlightField, which is always set either way.
        let isSpecialFind = !!highlightField;
        if (!highlightField) {
            highlightField = this.findFineCategoryHighlight(portNameFields);
            isSpecialFind = !!highlightField;
            highlightField = highlightField || portNameFields[0];
        }

        if (highlightField) this.applyHighlight(highlightField);
        console.log(`🟡 Highlighted: ${highlightField?.name} (${highlightField?.value})`);

        // Exposed so other features (e.g. vessel recommendation) can
        // know which port is currently highlighted without re-running
        // this whole scan themselves.
        this.currentHighlightField = highlightField || null;
        this.hasSpecialPort = isSpecialFind;
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