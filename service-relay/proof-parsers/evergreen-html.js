// ============================================================
//  proof-parsers/evergreen-html.js
//  Parses a saved Evergreen ShipmentLink "Sailing Schedules"
//  page (the real download_txt/{SERVICE}_{CODE}.html export --
//  confirmed real via 4 sample pages this session: AEF_W,
//  CIX3_9, NSA_9, NSD_9). Same "saved file, no live browser
//  needed" approach as proof-parsers/yangming-html.js, but a
//  genuinely different table layout:
//
//    - No <thead>/<tbody> at all -- one flat <table
//      class='f13tabn1'> per direction, with header rows
//      distinguished from data rows by CSS class alone:
//      td.f09tilb1 = header (port names), td.f09rown1 /
//      td.f09rown2 = alternating-stripe data rows. The header
//      repeats partway through a long table (skipped here, not
//      re-parsed).
//    - Vessel + voyage are ONE combined text cell, not
//      separate columns -- e.g. "PROTOSTAR 104W" (no fleet-
//      sequence prefix, slot-charter partner vessel) or
//      "EVER CHANT 2090-116S" (Evergreen's own vessel, dash-
//      prefixed fleet sequence number that Tradetech's own
//      voyage field never carries -- confirmed same convention
//      already handled for this exact case in evergreen.js's
//      PDF parser). Direction letter varies by service (W/E
//      for some, S/N for others), always the last character.
//    - One column PER PORT (not two like Yang Ming's ETB/ETD
//      pair columns) -- each cell packs "ARR<BR>DEP" on two
//      lines; "---<BR>---" means no call at that port.
//    - No IMO anywhere in this table.
//    - Real, confirmed: ONE saved file can contain MULTIPLE
//      directions already (CIX3_9.html had CIX3W + CIX3E in one
//      document; the URL's numeric suffix apparently means
//      "whole loop" vs a single-direction W/E/S/N suffix). Each
//      direction is its own heading <p class='f14tilb2'> +
//      <a name='{SERVICE}{DIRECTION}'> + <table class='f13tabn1'>
//      trio, always in that order and always 1:1 (confirmed via
//      jsdom on a real sample) -- paired positionally rather
//      than by any structural nesting.
// ============================================================

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HEADER_CLASS = "f09tilb1";

// "PROTOSTAR 104W" -> { vessel: "PROTOSTAR", voyage: "104" }
// "EVER CHANT 2090-116S" -> { vessel: "EVER CHANT", voyage: "116" }
// "KMTC DUBAI 2605W" -> { vessel: "KMTC DUBAI", voyage: "2605" }
// The optional "digits-" prefix is Evergreen's own fleet-sequence number,
// discarded -- Tradetech's own voyage field for this operator holds only
// the ship's own voyage number, same convention evergreen.js's existing
// PDF parser already relies on for the dash-prefixed case.
function parseVesselVoyage(cellText) {
    const match = String(cellText || "").trim().match(/^(.*?)\s+(?:\d+-)?(\d+)[A-Z]$/);
    if (!match) return null;
    return { vessel: match[1].trim(), voyage: match[2] };
}

// "07/26" + running year-tracking state -> { text: "07/26/26", time: <ms> },
// identical rollover rule to yangming-html.js's normalizeDate() -- a real
// rotation can cross a calendar year boundary mid-row. ETA and ETD are
// tracked with SEPARATE state (each moves forward independently port to
// port), same convention as yangming-html.js. A skipped port ("---") never
// reaches this function (filtered by the caller), so it can't corrupt the
// rollover tracking for the next real date in the row.
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

// A cell like "07/22<BR>07/23" -> ["07/22", "07/23"]. cell.textContent
// would concatenate the two lines with NO separator at all (a <br> element
// contributes nothing to textContent), so this splits the raw innerHTML on
// the tag itself instead.
function splitBrCell(cell) {
    return cell.innerHTML.split(/<br\s*\/?>/i).map(s => s.trim());
}

// Parses ONE direction's <table class='f13tabn1'>. Returns a flat rows[]
// in the same shape fill-calc.js expects everywhere else in this project.
function parseOneTable(table, baseYear) {
    const rows = [];
    let portNames = null;

    for (const row of Array.from(table.querySelectorAll("tr"))) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (!cells.length) continue;

        if (cells[0].className.includes(HEADER_CLASS)) {
            // First cell is the colspan=2 identity-column spacer; the rest
            // are port names in left-to-right order. A long table reprints
            // this header partway through -- re-reading it here is harmless
            // (same port order every time), just skip to the next row.
            portNames = cells.slice(1).map(td => td.textContent.trim());
            continue;
        }

        if (!portNames) continue; // a data row shouldn't appear before any header on a real page

        const identity = parseVesselVoyage(cells[0].textContent);
        if (!identity) continue;

        const etaState = { year: baseYear, priorMonth: null };
        const etdState = { year: baseYear, priorMonth: null };

        // cells[1] is the literal "ARR<BR>DEP" row label, not data --
        // cells[2..] are one cell per port, in the same order as portNames.
        for (let p = 0; p < portNames.length; p++) {
            const cell = cells[2 + p];
            if (!cell) continue;

            const [arrRaw, depRaw] = splitBrCell(cell);
            if (!arrRaw || !depRaw || arrRaw === "---" || depRaw === "---") continue;

            const eta = normalizeDate(arrRaw, etaState);
            const etd = normalizeDate(depRaw, etdState);
            if (!eta.text || !etd.text) continue;

            rows.push({
                vessel: identity.vessel,
                voyage: identity.voyage,
                imo: null,
                port: portNames[p],
                eta: eta.text,
                etd: etd.text,
                source: "dom-scrape",
                ocrConfidence: null,
            });
        }
    }

    return rows;
}

// Each direction is a heading <p class='f14tilb2'>...(<CODE>)<a
// name='<CODE><DIRECTION>'>...</p> immediately followed by its
// <table class='f13tabn1'> -- confirmed 1:1 and in-order on a real
// multi-direction page (CIX3_9.html: 2 headings, 2 tables, anchors
// ['CIX3W','CIX3E'] in the same order), so headings/anchors/tables are
// paired positionally rather than via any DOM nesting relationship.
function detectSections(doc) {
    const headings = Array.from(doc.querySelectorAll("p.f14tilb2"));
    const tables = Array.from(doc.querySelectorAll("table.f13tabn1"));
    const anchors = Array.from(doc.querySelectorAll("a[name]"))
        .map(a => a.getAttribute("name"))
        .filter(name => name && name.toLowerCase() !== "top");

    const sections = [];
    for (let i = 0; i < tables.length; i++) {
        const headingText = headings[i] ? headings[i].textContent.trim() : "";
        const codeMatch = headingText.match(/\(([A-Z0-9]{2,10})\)\s*$/);
        const service = codeMatch ? codeMatch[1] : null;
        const anchorName = anchors[i] || "";
        const direction = service && anchorName.startsWith(service) ? anchorName.slice(service.length) || null : null;
        sections.push({ service, direction, table: tables[i] });
    }
    return sections;
}

// Parses one saved HTML file. Returns { service, directions: [{ direction,
// rows }, ...] } -- same shape as yangming-html.js's parseYangMingHtmlFile,
// but directions[] can hold more than one entry here since a real save can
// carry multiple directions in one file. Throws if it doesn't look like a
// real Evergreen ShipmentLink schedule page.
async function parseEvergreenHtmlFile(filePath) {
    const html = fs.readFileSync(filePath, "utf8");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const sections = detectSections(doc);
    const baseYear = new Date().getFullYear();

    let service = null;
    const directions = [];
    for (const section of sections) {
        if (!section.service) continue;
        service = service || section.service;
        const rows = parseOneTable(section.table, baseYear);
        if (rows.length) directions.push({ direction: section.direction, rows });
    }

    if (!service) throw new Error(`could not detect a service code in ${path.basename(filePath)} -- not a recognized Evergreen ShipmentLink schedule page`);
    if (!directions.length) throw new Error(`no table rows found in ${path.basename(filePath)}`);

    return { service, directions };
}

module.exports = { parseEvergreenHtmlFile, parseOneTable, detectSections, parseVesselVoyage };
