// ============================================================
//  proof-parsers/yangming-html.js
//  Parses a Yang Ming schedule page saved locally via the
//  browser's own "Save Page As -> Webpage, HTML only" (no
//  extension involvement at all -- built as a fallback after
//  the live content-script -> background-worker -> relay path
//  proved hard to get running reliably in the real browser).
//
//  Same real-DOM-based parsing logic as
//  src/features/schedule-table-scrape.js (verified against the
//  real live Yang Ming page this session), ported to run in
//  Node against a saved file via jsdom instead of a live tab.
//  Real confirmed table structure -- see that file's header
//  comment for the full breakdown (identity columns, port
//  column groups, main+estimate row pairs, "-----" placeholder).
// ============================================================

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function cellText(cell) {
    if (!cell) return "";
    const link = cell.querySelector("a");
    return (link ? link.textContent : cell.textContent).trim();
}

// "07/26" + running year-tracking state -> { text: "07/26/26", time: <ms> },
// identical rollover rule to proof-parsers/default.js's assignDatesToPorts()
// and to schedule-table-scrape.js's own normalizeDate().
function normalizeDate(raw, state) {
    const match = String(raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!match) return { text: "", time: null };
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    if (state.priorMonth !== null && state.priorMonth >= 11 && month <= 2) state.year++;
    state.priorMonth = month;
    const text = `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${String(state.year).slice(-2)}`;
    const time = Date.UTC(state.year, month - 1, day);
    return { text, time };
}

// Returns { rows, portCodes } -- same shape/logic as
// ScheduleTableScrape.parseTable() in the content script, including the
// adjacent-same-port merge (confirmed real: "SEGOT / DEHAM / DEHAM" columns
// where the two DEHAMs are one continuous stay, not two rotation legs).
//
// A page can hold MULTIPLE <table> elements, not just one -- confirmed
// real on MD3 (Mediterranean Service-3): unlike IE8's single shared table
// covering every vessel, MD3 renders one SEPARATE <table> per vessel (each
// with its own header, since different vessels call a different subset of
// this route's 15+ ports -- one table had 51 header cells, another 48).
// Same per-table row structure either way (main+estimate pairs, "*"
// marker, "-----" placeholder) -- just parse every table found and
// concatenate the results, rather than assuming exactly one.
function parseTable(doc, baseYear) {
    const tables = Array.from(doc.querySelectorAll("table"));
    const rows = [];
    const portCodesByTable = [];
    for (const table of tables) {
        const parsed = parseOneTable(table, baseYear);
        rows.push(...parsed.rows);
        if (parsed.portCodes.length) portCodesByTable.push(parsed.portCodes);
    }
    // portCodes returned for backward-compat / diagnostics only -- callers
    // should not assume a single shared list when multiple tables exist.
    return { rows, portCodes: portCodesByTable[0] || [] };
}

function parseOneTable(table, baseYear) {
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

        const vessel = cellText(mainCells[1]);
        const imoRaw = cellText(mainCells[3]);
        const imo = imoRaw && imoRaw !== "N/A" ? imoRaw : null;
        const voyage = cellText(mainCells[5]);
        if (!vessel || !voyage) continue;

        const estimateRow = bodyRows[i + 1] || null;
        const estimateCells = estimateRow ? Array.from(estimateRow.querySelectorAll("td")) : null;
        const hasEstimateMarker = Boolean(
            estimateCells && estimateCells[identityColumns - 1] &&
            estimateCells[identityColumns - 1].textContent.trim() === "*"
        );

        const etaState = { year: baseYear, priorMonth: null };
        const etdState = { year: baseYear, priorMonth: null };
        const calls = [];

        for (let p = 0; p < portCodes.length; p++) {
            const etbIndex = identityColumns + p * 2;
            const etdIndex = etbIndex + 1;

            let etaRaw = cellText(mainCells[etbIndex]);
            let etdRaw = cellText(mainCells[etdIndex]);

            if (hasEstimateMarker && estimateCells) {
                const estEta = cellText(estimateCells[etbIndex]);
                const estEtd = cellText(estimateCells[etdIndex]);
                if (estEta && estEta !== "-----") etaRaw = estEta;
                if (estEtd && estEtd !== "-----") etdRaw = estEtd;
            }

            calls.push({
                port: portCodes[p],
                eta: normalizeDate(etaRaw, etaState),
                etd: normalizeDate(etdRaw, etdState),
            });
        }

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
}

// The saved page's own heading text names its direction, e.g.
// "IE8 - INTRA EUROPE FEEDER SERVICE VIII (S-Bound)" or, confirmed real,
// "MD3 - MEDITERRANEAN SERVICE-3 (TIGER) (E-Bound)" -- all four compass
// directions are real (S/N for IE8, E confirmed for MD3; W included for
// symmetry, not yet confirmed on a real page). Read straight from the
// file's own content rather than trusting the filename, since "Save Page
// As" doesn't preserve the URL's query params in the saved filename.
function detectDirection(doc) {
    const text = doc.body ? doc.body.textContent : "";
    const match = text.match(/\(([SNEW])-Bound\)/i);
    return match ? match[1].toUpperCase() : null;
}

// The service-name portion between the code and "(_-Bound)" can itself
// contain parens/digits/hyphens (confirmed real: "MEDITERRANEAN SERVICE-3
// (TIGER)"), so the middle segment is matched loosely rather than assuming
// IE8's simpler "INTRA EUROPE FEEDER SERVICE VIII" shape.
function detectService(doc) {
    const text = doc.body ? doc.body.textContent : "";
    // Deliberately case-SENSITIVE for the code itself (a lowercase "i" flag
    // here let stray lowercase text like "...service..." bleed into the
    // capture group and produce "serviceMD3" instead of "MD3" -- real bug,
    // caught by testing against the real MD3 page). The "(_-Bound)" suffix
    // is always uppercase on every real page seen so far, so no
    // case-insensitivity is needed there either.
    const match = text.match(/([A-Z0-9]{2,10})\s*-\s*.+?\([SNEW]-Bound\)/);
    return match ? match[1] : null;
}

// Parses one saved HTML file. Returns { service, directions: [{ direction,
// rows }] } -- a single-entry directions[] here, since one Yang Ming save
// only ever covers one direction, but this keeps the shape uniform with
// other operators' HTML parsers (see proof-parsers/evergreen-html.js, whose
// real saved pages can carry multiple directions in one file) so
// download-watcher.js can loop over `directions` the same way regardless of
// which parser produced it. Throws if it doesn't look like a real Yang
// Ming schedule page.
async function parseYangMingHtmlFile(filePath) {
    const html = fs.readFileSync(filePath, "utf8");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const service = detectService(doc);
    const direction = detectDirection(doc);
    if (!service) throw new Error(`could not detect a service code in ${path.basename(filePath)} -- not a recognized Yang Ming schedule page`);

    const baseYear = new Date().getFullYear();
    const { rows } = parseTable(doc, baseYear);
    if (!rows.length) throw new Error(`no table rows found in ${path.basename(filePath)}`);

    return { service, directions: [{ direction, rows }] };
}

module.exports = { parseYangMingHtmlFile, parseTable, detectDirection, detectService };
