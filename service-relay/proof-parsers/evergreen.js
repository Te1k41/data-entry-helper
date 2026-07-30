// ============================================================
//  proof-parsers/evergreen.js — Evergreen (EVG) ShipmentLink
//  "Sailing Schedules" PDF export. One row per vessel/voyage,
//  one column per port — each port cell packs "ARR\nDEP" on two
//  lines. A route too long for one page prints as multiple
//  tables (one per page), each with its own port columns; the
//  same voyage's rows across pages carry a leg-half letter
//  suffix (e.g. "0147-109A" / "0147-109B") that's stripped here
//  — Tradetech's own voyage field for this service holds only
//  the ship's own voyage number ("109"), not the fleet-wide
//  sequence number or the leg letter.
//
//  KNOWN GAP: the last port of one leg and the first port of the
//  next leg are the same physical call (same port, same dates) —
//  this parser emits both as separate rows, no merge.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

// "EVER CLEAR 0147-109A" -> { vessel: "EVER CLEAR", voyage: "109" }.
function parseVesselVoyage(cell) {
    const m = String(cell || "").trim().match(/^(.*?)\s+\d+-(\d+)[A-Z]?$/);
    if (!m) return null;
    return { vessel: m[1].trim(), voyage: m[2] };
}

// "07/24\n07/25" -> { eta: "07/24/26", etd: "07/25/26" }. Cells only
// ever hold MM/DD, no year — tracked across the row (each vessel's
// own ports move forward in time), rolling over on a month decrease
// (Dec -> Jan). "---\n---" means no call at that port.
function parseDateCell(cell, state) {
    const raw = String(cell || "").trim();
    if (!raw) return null;
    const [arrRaw, depRaw] = raw.split("\n").map(s => (s || "").trim());
    if (!arrRaw || !depRaw || arrRaw === "---" || depRaw === "---") return null;

    const eta = applyYear(arrRaw, state);
    const etd = applyYear(depRaw, state);
    if (!eta || !etd) return null;
    return { eta, etd };
}

function applyYear(mmdd, state) {
    const m = mmdd.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return null;
    const month = Number(m[1]), day = Number(m[2]);
    if (state.month !== null && month < state.month) state.year++;
    state.month = month;
    return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${String(state.year).slice(2)}`;
}

// Header row has no placeholder for the "ARR\nDEP" label column that
// every data row carries (blank cell, then straight into port names) —
// data rows have vessel+label+dates, so a data row's date column is
// always one past its matching header column: header[h] -> row[h + 1].
function extractFromTable(table, docYear) {
    const out = [];
    const header = table[0] || [];

    const portCols = [];
    for (let h = 1; h < header.length; h++) {
        const name = String(header[h] ?? "").replace(/\s+/g, " ").trim();
        if (name) portCols.push({ col: h + 1, name });
    }

    for (let r = 1; r < table.length; r++) {
        const row = table[r] || [];
        const vv = parseVesselVoyage(row[0]);
        if (!vv) continue;

        // Year tracking resets per row — a fresh vessel/voyage's own
        // port-to-port progression, not shared with any other row.
        const state = { year: docYear, month: null };
        for (const { col, name } of portCols) {
            const parsed = parseDateCell(row[col], state);
            if (!parsed) continue;
            out.push({ vessel: vv.vessel, voyage: vv.voyage, port: name, eta: parsed.eta, etd: parsed.etd });
        }
    }
    return out;
}

async function extractPdf(filePath) {
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });

    let result;
    try {
        result = await parser.getTable();
    } finally {
        await parser.destroy();
    }

    const docYear = new Date().getFullYear(); // "Last Update Date" sits outside the table

    const out = [];
    for (const page of result.pages) {
        for (const table of page.tables || []) {
            out.push(...extractFromTable(table, docYear));
        }
    }

    if (out.length === 0) {
        throw new Error(`Evergreen parser: no vessel rows found in ${path.basename(filePath)}`);
    }
    return out;
}

// Evergreen's ShipmentLink export has only shown up as PDF so far.
// Add extractExcel/extractText here once a sample of those shows up.

module.exports = { extractPdf };
