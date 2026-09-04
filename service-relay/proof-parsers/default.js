// ============================================================
//  proof-parsers/default.js — generic fallback parser
//  Used for any service without its own parser in
//  proof-parsers/index.js's registry. Finds a header row by
//  keyword match (Vessel/Voyage/ETA/ETD) and reads rows below
//  it. Works for straightforward schedule-table layouts; a
//  service with a weirder layout gets its own parser module
//  instead of fighting this one.
//
//  Image/OCR proof extraction (extractImage, and the Tesseract/
//  PaddleOCR machinery it depended on) was removed -- schedule
//  data now comes from real operator DOM scrapes (see
//  src/features/schedule-table-scrape.js /
//  proof-parsers/yangming-html.js) instead of recognizing pixels
//  in a screenshot. extractExcel/extractPdf/extractText (real
//  structured file formats, not image recognition) are unaffected.
// ============================================================

const fs   = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");

const HEADER_KEYWORDS = {
    vessel: ["vessel", "vsl"],
    voyage: ["voyage", "voy no", "voy"],
    eta:    ["eta", "arrival"],
    etd:    ["etd", "departure"],
};

// Scan the first few rows for one that looks like a header (must have
// at least Vessel + Voyage columns to count — anything less is too
// ambiguous to trust as the start of the table).
function findHeaderMap(rows) {
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const row = (rows[r] || []).map(c => String(c ?? "").trim().toLowerCase());
        const map = {};
        for (const [field, keywords] of Object.entries(HEADER_KEYWORDS)) {
            const idx = row.findIndex(cell => keywords.some(k => cell.includes(k)));
            if (idx !== -1) map[field] = idx;
        }
        if (map.vessel !== undefined && map.voyage !== undefined) {
            return { headerRow: r, map };
        }
    }
    return null;
}

function rowsFromTable(table, map, headerRow) {
    const out = [];
    for (let r = headerRow + 1; r < table.length; r++) {
        const row = table[r] || [];
        const vessel = map.vessel !== undefined ? String(row[map.vessel] ?? "").trim() : "";
        if (!vessel) continue; // blank vessel cell = end of table (best-effort)
        out.push({
            vessel,
            voyage: map.voyage !== undefined ? String(row[map.voyage] ?? "").trim() : "",
            eta:    map.eta !== undefined ? String(row[map.eta] ?? "").trim() : "",
            etd:    map.etd !== undefined ? String(row[map.etd] ?? "").trim() : "",
        });
    }
    return out;
}

function extractExcel(filePath) {
    const wb    = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

    const found = findHeaderMap(rows);
    if (!found) {
        throw new Error(`No Vessel/Voyage header row found in ${path.basename(filePath)} — this service may need a custom parser.`);
    }

    return rowsFromTable(rows, found.map, found.headerRow);
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

    const out = [];
    for (const page of result.pages) {
        for (const table of page.tables || []) {
            const found = findHeaderMap(table);
            if (!found) continue;
            out.push(...rowsFromTable(table, found.map, found.headerRow));
        }
    }

    if (out.length === 0) {
        throw new Error(`No vessel/voyage table found in ${path.basename(filePath)} — this service may need a custom parser.`);
    }
    return out;
}

// Plain-text proofs — best-effort table read. Splits each line on
// runs of 2+ spaces or a tab (the common way carriers pad a
// copy-pasted schedule table into a .txt file); a real operator
// parser should replace this once we see an actual sample.
function extractText(filePath) {
    const text  = fs.readFileSync(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const rows  = lines.map(line => line.split(/\t| {2,}/).map(c => c.trim()));

    const found = findHeaderMap(rows);
    if (!found) {
        throw new Error(`No Vessel/Voyage header row found in ${path.basename(filePath)} — this service may need a custom parser.`);
    }

    return rowsFromTable(rows, found.map, found.headerRow);
}

module.exports = { extractExcel, extractPdf, extractText };
