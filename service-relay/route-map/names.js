// ============================================================
//  route-map/names.js — port/country name normalizing, shared by
//  build-data.js (indexing the sources) and locate.js (looking a
//  Tradetech port name up), so both sides normalize identically.
// ============================================================

// Words that don't tell two ports apart ("SHEKOU PT", "PORT OF X").
const FILLER = new Set(["PT", "PORT", "OF", "THE", "HARBOUR", "HARBOR", "TERMINAL"]);

// "Göteborg (Gothenburg)" -> "GOTEBORG GOTHENBURG": no accents, upper
// case, punctuation -> spaces, filler words dropped.
function normKey(s) {
    return String(s || "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()
        .split(" ").filter(w => w && !FILLER.has(w)).join(" ");
}

// Every key a name should be findable under: the whole name, each
// "(alternate)", the name without them, and each "/"-separated part —
// "ANTWERP (ANTWERPEN)" -> ANTWERP, ANTWERPEN; "HAKATA/FUKUOKA" ->
// HAKATA FUKUOKA, HAKATA, FUKUOKA.
function nameVariants(name) {
    const out = new Set([name]);
    for (const m of String(name).matchAll(/\(([^)]+)\)/g)) out.add(m[1]);
    out.add(String(name).replace(/\([^)]*\)/g, ""));
    for (const v of [...out]) v.split("/").forEach(part => out.add(part));
    return [...new Set([...out].map(normKey).filter(Boolean))];
}

module.exports = { normKey, nameVariants };
