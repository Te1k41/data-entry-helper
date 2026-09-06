// ============================================================
//  proof-parsers/oocl.js — OOCL (Orient Overseas Container Line)
//  "Sailing Schedule by Service Loop" PDF export. Vessels run in
//  parallel columns, N per block (a "Vessel Name"/"Vessel/Voyage"/
//  "Port"+"Arr--Dep" header trio), stacked in blocks down the page.
//  Each data row holds one (port, Arr--Dep) pair per vessel column;
//  a vessel whose rotation ends early just leaves its columns blank
//  for the remaining rows.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function pad(n) { return String(n).padStart(2, "0"); }
function fmtDate(month, day, year) { return `${pad(month)}/${pad(day)}/${String(year).slice(2)}`; }

// "OMS/071" -> "071" — OOCL's own cell prefixes the voyage with its vessel
// code, but the guideline (captured off Tradetech) stores the bare voyage
// number, so matchRows() in schedule-guideline-store.js would never match
// the prefixed form.
function coreVoyageNumber(v) {
    return String(v || "").trim().replace(/^[^/]*\//, "");
}

// "28--30 May" -> arrival day 28, departure day 30, both May.
// "31--02 Sep" -> arrival day 31 is the PRIOR month (arr > dep means the
// leg crossed a month boundary); departure day 02 is Sep.
// ponytail: assumes each column's dates only move forward (never revisits
// an earlier month) — true for real sailing schedules — to detect a year
// rollover (Dec -> Jan). Out-of-order/edited rows would need real dates.
function parseArrDep(cell, colState) {
    const m = String(cell || "").trim().match(/^(\d{1,2})--(\d{1,2})\s+([A-Za-z]{3})$/);
    if (!m) return null;
    const [, arrDayStr, depDayStr, monAbbr] = m;
    const month = MONTHS[monAbbr.toLowerCase()];
    if (!month) return null;
    const arrDay = Number(arrDayStr);
    const depDay = Number(depDayStr);

    if (colState.month !== null && month < colState.month) colState.year++;
    colState.month = month;

    let arrMonth = month, arrYear = colState.year;
    if (arrDay > depDay) {
        arrMonth--;
        if (arrMonth === 0) { arrMonth = 12; arrYear--; }
    }

    return { eta: fmtDate(arrMonth, arrDay, arrYear), etd: fmtDate(month, depDay, colState.year) };
}

// ponytail: colStates reset for every block — a column position's vessel
// changes block to block (rotation queue, not one continuous timeline), so
// year/month tracking only carries forward WITHIN a single vessel's own rows.
function extractFromRows(rows, docYear) {
    const out = [];
    let i = 0;
    while (i < rows.length) {
        const nameRow = rows[i] || [];
        if (String(nameRow[0] ?? "").trim().toLowerCase() !== "vessel name") { i++; continue; }

        const voyageRow = rows[i + 1] || [];
        const pairCount = Math.floor(nameRow.length / 2);
        const colStates = [];
        for (let p = 0; p < pairCount; p++) colStates[p] = { year: docYear, month: null };
        i += 3; // skip Vessel Name / Vessel-Voyage / Port-Arr--Dep header rows

        while (i < rows.length) {
            const dataRow = rows[i] || [];
            if (String(dataRow[0] ?? "").trim().toLowerCase() === "vessel name") break; // next block

            for (let p = 0; p < pairCount; p++) {
                const port   = String(dataRow[2 * p] ?? "").replace(/\s+/g, " ").trim();
                const arrDep = dataRow[2 * p + 1];
                if (!port || !arrDep) continue;
                const parsed = parseArrDep(arrDep, colStates[p]);
                if (!parsed) continue;
                out.push({
                    // A vessel-name cell that wraps to a second line comes
                    // back from pdf-parse with an embedded newline (e.g.
                    // "INTERASIA\nPROGRESS") — collapse any whitespace run
                    // to a single space so it reads and matches normally.
                    vessel: String(nameRow[2 * p + 1] ?? "").replace(/\s+/g, " ").trim(),
                    voyage: coreVoyageNumber(voyageRow[2 * p + 1]),
                    port,
                    eta: parsed.eta,
                    etd: parsed.etd,
                });
            }
            i++;
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

    const docYear = new Date().getFullYear(); // "Last Update Date" sits outside the table; today's year is the safe default

    // A vessel block's header row can land at the very bottom of one page
    // with its data rows continuing onto the next — pdf-parse hands back
    // one table per PAGE, so processing each page's table separately
    // splits that single block into a header-only fragment (no data
    // follows before the page ends) and a data-only fragment (no header
    // precedes it on the next page), and both get silently dropped.
    // Flattening every page's rows into one continuous stream first means
    // the header and its data are simply adjacent, page break or not.
    const allRows = [];
    for (const page of result.pages) {
        for (const table of page.tables || []) {
            allRows.push(...table);
        }
    }
    const out = extractFromRows(allRows, docYear);

    if (out.length === 0) {
        throw new Error(`OOCL parser: no "Vessel Name" block found in ${path.basename(filePath)}`);
    }
    return out;
}

// OOCL's schedule export has only shown up as PDF so far. Add
// extractExcel/extractText here once a sample of those shows up.

module.exports = { extractPdf };
