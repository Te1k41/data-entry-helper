// Run: node service-relay/route-map/locate.selftest.js
// Checks locate.js against known ports (real data, built on first run)
// and reports coverage over the stored Highlight Review receipts.
const fs = require("fs");
const assert = require("assert");
const { locate } = require("./locate");
const { HIGHLIGHT_REVIEW_FILE } = require("../config");

const near = (hit, lat, lon, km = 60) => {
    assert(hit, `expected a hit near ${lat},${lon}`);
    const d = Math.hypot((hit.lat - lat) * 111, (hit.lon - lon) * 111 * Math.cos(lat * Math.PI / 180));
    assert(d < km, `${hit.matched} is ${Math.round(d)} km from ${lat},${lon}`);
};

(async () => {
    const cases = [
        [{ name: "SHANGHAI, CHINA", code: "SHA" }, 31.3, 121.5],
        [{ name: "LOS ANGELES, CA USA", code: "LAX" }, 33.9, -118.3],
        [{ name: "KAOHSIUNG, TAIWAN", code: "KHH" }, 22.6, 120.3],
        [{ name: "SINGAPORE", code: "SIN" }, 1.27, 103.8],
        [{ name: "ANTWERP (ANTWERPEN), BELGIUM", code: "ANR" }, 51.25, 4.35],
        [{ name: "HAKATA/FUKUOKA, JAPAN", code: "HKT" }, 33.6, 130.4],
        [{ name: "PORT KELANG, MALAYSIA", code: "PKG" }, 3.0, 101.4],      // was wrongly Kelang Baharu
        [{ name: "GLOUCESTER CITY, NJ USA", code: "GLC" }, 39.9, -75.1, "or-unplaced"], // was wrongly Gloucester, VA
        [{ name: "SUEZ CANAL, EGYPT", code: "SUZ" }, 30.6, 32.3],
        [{ name: "FUKUYAMA, HIROSHIMA, JAPAN", code: "FKY" }, 34.4, 133.4],
        [{ name: "TANGER MED, MOROCCO", code: "TNG" }, 35.88, -5.51],       // alias -> Tangier Mediterranean
    ];
    const hits = await locate(cases.map(c => c[0]));
    const fails = [];
    cases.forEach(([p, lat, lon, mode], i) => { try { if (!(mode === "or-unplaced" && !hits[i])) near(hits[i], lat, lon); } catch (e) { fails.push(`${p.name}: ${e.message} (${JSON.stringify(hits[i])})`); } });

    const items = Object.values(JSON.parse(fs.readFileSync(HIGHLIGHT_REVIEW_FILE, "utf8")));
    const distinct = new Map();
    for (const it of items) for (const p of it.ports || []) if (p.name) distinct.set(p.name, p);
    const all = await locate([...distinct.values()]);
    const how = {};
    all.forEach(h => { how[h ? h.how : "unplaced"] = (how[h ? h.how : "unplaced"] || 0) + 1; });
    console.log(`coverage: ${distinct.size - (how.unplaced || 0)}/${distinct.size} placed`, how);

    if (fails.length) { console.error("❌\n" + fails.join("\n")); process.exit(1); }
    console.log(`✅ ${cases.length} known ports placed correctly`);
})();
