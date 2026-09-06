// ─────────────────────────────────────────────────────
//  FEATURE: Schedule Table Scrape
//  Reads Yang Ming's own public schedule table directly as
//  real HTML text instead of OCR'ing a screenshot of it —
//  confirmed via direct inspection that the real page is a
//  genuine server-rendered <table>, not a canvas/image. This
//  eliminates the entire class of pixel-recognition bugs the
//  OCR pipeline has to work around (digit misreads, header
//  confusion, phantom columns, split-row guessing).
//
//  Runs alongside the existing screenshot-and-upload flow
//  (full-page-capture-inject.js / UploadProof) without
//  touching it — that flow still produces the screenshot
//  Tradetech's own Support Document upload requires. This
//  feature is a second, additive, more reliable data source
//  sent to the relay for the fill-calc pipeline to prefer.
//
//  Real table structure confirmed by direct inspection:
//    <thead> row 1: 6 rowspan=2 identity columns (New Voy.
//      Code / Vessel Name / Alliance Code / IMO No. /
//      YM Vessel Abbr. / Comn. Voy.), then one colspan=2 <th>
//      per port call (a port code can repeat).
//    <thead> row 2: ETB / ETD under each port group.
//    <tbody>: rows come in PAIRS —
//      - a "main" row with the 6 identity cells + one ETB/ETD
//        pair per port (the currently-scheduled dates)
//      - an "estimate" row immediately after: the 6 identity
//        cells are blank except a literal "*" in the Comn.
//        Voy. position, followed by that row's own ETB/ETD
//        pair per port — either a real (usually later/updated)
//        date, or the literal placeholder text "-----" meaning
//        "no estimate override, keep the main row's date".
//      Dates are bare "MM/DD" with no year — the page shows a
//      "Generate Date" but real vessel data can roll into the
//      next calendar year mid-rotation, so the year is tracked
//      the same way the OCR pipeline already does (see
//      proof-parsers/default.js's assignDatesToPorts): start
//      at the current year, and bump forward by one whenever a
//      date's month is Jan/Feb right after a Nov/Dec date in
//      the same row's left-to-right port sequence.
// ─────────────────────────────────────────────────────
const ScheduleTableScrape = {

    isSchedulePage() {
        return location.hostname === "www.yangming.com" &&
            location.pathname === "/en/esolution/long_term_schedule_detail";
    },

    init() {
        console.log(`🔍 ScheduleTableScrape loaded on ${location.hostname}${location.pathname} -- isSchedulePage: ${this.isSchedulePage()}`);
        if (!this.isSchedulePage()) return;
        setTimeout(() => {
            this.scrapeAndSend().catch(err => console.error("❌ ScheduleTableScrape.scrapeAndSend failed:", err));
        }, 1000);
    },

    currentParams() {
        const params = new URLSearchParams(location.search);
        return { loop: params.get("loop") || "", directn: (params.get("directn") || "").toUpperCase() };
    },

    // "07/26" + running year-tracking state -> { text: "07/26/26", time: <ms> },
    // mirroring proof-parsers/default.js's assignDatesToPorts() year-rollover
    // rule exactly (a rotation can cross a calendar year boundary mid-row).
    // Returns a real timestamp alongside the display string so later
    // comparisons (e.g. the adjacent-port merge below) sort chronologically
    // instead of comparing "MM/DD/YY" as text, which sorts the year LAST
    // and would get a year-boundary case backwards.
    normalizeDate(raw, state) {
        const match = String(raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})$/);
        if (!match) return { text: "", time: null };
        const month = parseInt(match[1], 10);
        const day = parseInt(match[2], 10);
        if (state.priorMonth !== null && state.priorMonth >= 11 && month <= 2) state.year++;
        state.priorMonth = month;
        const text = `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${String(state.year).slice(-2)}`;
        const time = Date.UTC(state.year, month - 1, day);
        return { text, time };
    },

    cellText(cell) {
        if (!cell) return "";
        const link = cell.querySelector("a");
        return (link ? link.textContent : cell.textContent).trim();
    },

    // Parses every table on the CURRENT document, concatenated. Returns
    // { rows, portCodes }. A page can hold multiple <table> elements, not
    // just one -- confirmed real on MD3 (Mediterranean Service-3): unlike
    // IE8's single shared table covering every vessel, MD3 renders one
    // SEPARATE <table> per vessel (each with its own header, since
    // different vessels call a different subset of a 15+ port rotation).
    // Same per-table row structure either way -- parse every table found.
    parseTable(doc) {
        const tables = Array.from(doc.querySelectorAll("table"));
        const rows = [];
        const portCodesByTable = [];
        for (const table of tables) {
            const parsed = this.parseOneTable(table);
            rows.push(...parsed.rows);
            if (parsed.portCodes.length) portCodesByTable.push(parsed.portCodes);
        }
        return { rows, portCodes: portCodesByTable[0] || [] };
    },

    parseOneTable(table) {
        if (!table) return { rows: [], portCodes: [] };

        const headerRows = table.querySelectorAll("thead tr");
        if (headerRows.length < 1) return { rows: [], portCodes: [] };
        const portHeaderCells = Array.from(headerRows[0].querySelectorAll("th")).slice(6);
        const portCodes = portHeaderCells.map(th => th.textContent.trim());
        if (!portCodes.length) return { rows: [], portCodes: [] };

        const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
        const identityColumns = 6;
        const expectedCells = identityColumns + portCodes.length * 2;
        const rows = [];

        for (let i = 0; i < bodyRows.length; i += 2) {
            const mainCells = Array.from(bodyRows[i].querySelectorAll("td"));
            if (mainCells.length < expectedCells) continue;

            const vessel = this.cellText(mainCells[1]);
            const imoRaw = this.cellText(mainCells[3]);
            const imo = imoRaw && imoRaw !== "N/A" ? imoRaw : null;
            const voyage = this.cellText(mainCells[5]); // "Comn. Voy." -- the bare number used for identity matching elsewhere in this codebase
            if (!vessel || !voyage) continue;

            const estimateRow = bodyRows[i + 1] || null;
            const estimateCells = estimateRow ? Array.from(estimateRow.querySelectorAll("td")) : null;
            const hasEstimateMarker = Boolean(
                estimateCells && estimateCells[identityColumns - 1] &&
                estimateCells[identityColumns - 1].textContent.trim() === "*"
            );

            const etaState = { year: this._baseYear, priorMonth: null };
            const etdState = { year: this._baseYear, priorMonth: null };
            const calls = [];

            for (let p = 0; p < portCodes.length; p++) {
                const etbIndex = identityColumns + p * 2;
                const etdIndex = etbIndex + 1;

                let etaRaw = this.cellText(mainCells[etbIndex]);
                let etdRaw = this.cellText(mainCells[etdIndex]);

                if (hasEstimateMarker && estimateCells) {
                    const estEta = this.cellText(estimateCells[etbIndex]);
                    const estEtd = this.cellText(estimateCells[etdIndex]);
                    if (estEta && estEta !== "-----") etaRaw = estEta;
                    if (estEtd && estEtd !== "-----") etdRaw = estEtd;
                }

                calls.push({
                    port: portCodes[p],
                    eta: this.normalizeDate(etaRaw, etaState),
                    etd: this.normalizeDate(etdRaw, etdState),
                });
            }

            // Two adjacent header columns with the SAME port code (confirmed
            // real, e.g. "SEGOT / DEHAM / DEHAM") represent one continuous
            // stay split across two columns, not two separate rotation
            // occurrences -- collapse them to one entry (earliest eta, latest
            // etd), same merge rule already established for the OCR pipeline.
            // Compared by real timestamp, not the "MM/DD/YY" display string
            // (which would sort a year boundary backwards, year being last).
            // A repeat separated by a DIFFERENT port in between (a genuine
            // loop-closure repeat) is left alone; fill-calc.js's own
            // chronological rotation-matching handles that case.
            const merged = [];
            for (const call of calls) {
                const previous = merged[merged.length - 1];
                if (previous && previous.port === call.port) {
                    if (call.eta.time !== null && (previous.eta.time === null || call.eta.time < previous.eta.time)) previous.eta = call.eta;
                    if (call.etd.time !== null && (previous.etd.time === null || call.etd.time > previous.etd.time)) previous.etd = call.etd;
                    continue;
                }
                merged.push({ ...call });
            }

            for (const call of merged) {
                rows.push({
                    vessel,
                    voyage,
                    imo,
                    port: call.port,
                    eta: call.eta.text,
                    etd: call.etd.text,
                    source: "dom-scrape",
                    ocrConfidence: null,
                });
            }
        }

        return { rows, portCodes };
    },

    async fetchOtherDirection(loop, otherDirn) {
        const url = `/en/esolution/long_term_schedule_detail?loop=${encodeURIComponent(loop)}&directn=${encodeURIComponent(otherDirn)}`;
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`fetch ${url} failed: ${response.status}`);
        const html = await response.text();
        const otherDoc = new DOMParser().parseFromString(html, "text/html");
        return this.parseTable(otherDoc);
    },

    async scrapeAndSend() {
        const { loop, directn } = this.currentParams();
        console.log(`🔍 ScheduleTableScrape.scrapeAndSend: loop=${loop || "(none)"} directn=${directn || "(none)"}`);
        if (!loop) {
            console.warn("⚠ ScheduleTableScrape: no 'loop' query param on this URL -- nothing to scrape");
            return;
        }

        this._baseYear = new Date().getFullYear();

        const own = this.parseTable(document);
        console.log(`🔍 ScheduleTableScrape: own-page parse found ${own.rows.length} row(s), portCodes=${JSON.stringify(own.portCodes)}`);
        let combinedRows = own.rows;
        let incomplete = false;
        let missingDirection = null;

        // S<->N confirmed real on IE8, E<->W confirmed real on MD3 (which
        // has a genuine "W-Bound" counterpart page, 3 tables) -- all four
        // compass directions pair up the same way.
        const OPPOSITE_DIRECTION = { S: "N", N: "S", E: "W", W: "E" };
        const otherDirn = OPPOSITE_DIRECTION[directn] || null;
        if (otherDirn) {
            try {
                const other = await this.fetchOtherDirection(loop, otherDirn);
                combinedRows = own.rows.concat(other.rows);
            } catch (err) {
                console.error(`❌ ScheduleTableScrape: could not fetch ${otherDirn}-bound direction:`, err);
                incomplete = true;
                missingDirection = otherDirn;
            }
        } else {
            // No direction param on this page at all -- treat as a
            // non-directional service with just the one table, not an error.
        }

        if (!combinedRows.length) return;

        // yangming.com's CSP blocks a direct WebSocket to localhost:3737
        // from this content script (confirmed by real testing -- same
        // class of restriction background.js's own comment already
        // documents for Maersk). The background service worker isn't
        // bound by any page's CSP, so it relays this over its own
        // already-open connection instead.
        chrome.runtime.sendMessage({
            type: "DOM_SCRAPE",
            payload: {
                service: loop,
                operator: "YML",
                rows: combinedRows,
                incomplete,
                missingDirection,
            },
        }, (response) => {
            if (chrome.runtime.lastError || !response?.ok) {
                console.warn("⚠ DOM schedule scrape was not saved — local relay server is unavailable");
                return;
            }
            console.log(`📤 DOM schedule scrape sent: ${loop} (${combinedRows.length} row(s)${incomplete ? ", incomplete: missing " + missingDirection : ""})`);
        });
    },
};
