// ============================================================
//  proof-parsers/one.js — ONE (Ocean Network Express)
//  "Long Range Schedule" export. Two-row header: port names on
//  one row, Arrival/Departure sub-labels on the row below, then
//  one row per vessel/voyage with an Arrival+Departure pair for
//  EACH port leg on the route (a loop route repeats a port).
//  Each output row is one (vessel, port leg) pair — a single
//  source row fans out into one output row per leg the vessel
//  actually calls at (legs with no dates are skipped).
// ============================================================

const path = require("path");
const XLSX = require("xlsx");

// "[L] 2026-07-29 08:00" / "2026-07-29 08:00" → "07/29/26" — strip the
// [L]/[A] estimate marker and time-of-day, match tradetech's own
// MM/DD/YY date fields.
function toShortDate(raw) {
    const m = String(raw || "").match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    const [, yyyy, mm, dd] = m;
    return `${mm}/${dd}/${yyyy.slice(2)}`;
}

function findHeaderRow(rows) {
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const row = (rows[r] || []).map(c => String(c ?? "").trim().toLowerCase());
        if (row[0] === "vessel" && row[1]?.startsWith("voyage")) return r;
    }
    return -1;
}

// Port name only appears in the first cell of its Arrival/Departure
// pair (the merged-cell header, flattened by sheet_to_json) — carry
// the last-seen name forward across columns.
function findPortColumns(headerRow, subHeaderRow) {
    let lastPortName = "";
    const portCols = [];
    for (let c = 2; c + 1 < headerRow.length; c++) {
        if (headerRow[c]) lastPortName = String(headerRow[c]).trim();
        const arrivalLabel = String(subHeaderRow[c] ?? "").trim().toLowerCase();
        const departLabel  = String(subHeaderRow[c + 1] ?? "").trim().toLowerCase();
        if (arrivalLabel === "arrival" && departLabel === "departure") {
            portCols.push({ name: lastPortName, arrivalCol: c, departCol: c + 1 });
            c++; // consumed the departure column too
        }
    }
    return portCols;
}

function extractExcel(filePath) {
    const wb    = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

    const headerRow = findHeaderRow(rows);
    if (headerRow === -1) {
        throw new Error(`ONE parser: no "Vessel"/"Voyage No." header row found in ${path.basename(filePath)}`);
    }

    const portCols = findPortColumns(rows[headerRow], rows[headerRow + 1] || []);
    if (portCols.length === 0) {
        throw new Error(`ONE parser: no Arrival/Departure port columns found in ${path.basename(filePath)}`);
    }

    const out = [];
    for (let r = headerRow + 2; r < rows.length; r++) {
        const row    = rows[r] || [];
        const vessel = String(row[0] ?? "").trim();
        const voyage = String(row[1] ?? "").trim();
        if (!vessel && !voyage) break; // blank separator row = end of table (legend follows it)

        for (const port of portCols) {
            const rawEta = String(row[port.arrivalCol] ?? "").trim();
            const rawEtd = String(row[port.departCol] ?? "").trim();
            if (!rawEta && !rawEtd) continue; // no call at this leg for this vessel
            out.push({ vessel, voyage, port: port.name, eta: toShortDate(rawEta), etd: toShortDate(rawEtd) });
        }
    }

    if (out.length === 0) {
        throw new Error(`ONE parser: found the header but no vessel rows in ${path.basename(filePath)}`);
    }
    return out;
}

// ONE's Long Range Schedule has only shown up as excel so far.
// Add extractPdf/extractText here once a sample of those shows up —
// until then this operator falls through to "unsupported" for any
// other file type (see proof-extract.js).

module.exports = { extractExcel };
