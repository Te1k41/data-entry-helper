// ============================================================
//  due-date-utils.js — Tradetech's own date format
//  e.g. "11-JUL-2026" — used for nextUpdateDate throughout
//  the due-services feature.
// ============================================================

const TT_MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function parseTTDate(dateStr) {
    const m = (dateStr || "").match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
    if (!m) return null;
    const monthIdx = TT_MONTHS.indexOf(m[2]);
    if (monthIdx === -1) return null;
    return new Date(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10));
}

function formatTTDate(date) {
    const dd   = String(date.getDate()).padStart(2, "0");
    const mon  = TT_MONTHS[date.getMonth()];
    const yyyy = date.getFullYear();
    return `${dd}-${mon}-${yyyy}`;
}

module.exports = { TT_MONTHS, parseTTDate, formatTTDate };
