// ============================================================
//  route-map/locate.js — Tradetech port name (+ code) -> coordinates
//
//  Tradetech names look like "SHANGHAI, CHINA", "LOS ANGELES, CA USA",
//  "FUKUYAMA, HIROSHIMA, JAPAN", "SINGAPORE". Tradetech's 3-letter codes
//  are often NOT UN/LOCODEs (Shanghai "SHA" vs CNSHG), so the lookup is
//  by NAME within the COUNTRY, in this order:
//    1. manual override (placed by clicking the map; route-map-overrides.json)
//    2. canal/strait waypoints Tradetech lists as "ports" (fixed points —
//       UN/LOCODE's own Suez Canal entry is 1,300 km off)
//    3. exact name (each variant) in that country — PortWatch first, then
//       UN/LOCODE ports, then any UN/LOCODE place (see build-data.js)
//    4. UN/LOCODE country + Tradetech code (sometimes they do match)
//    5. loose word match in that country — marked approximate
//  A US/CA/MX/AU state code in the name ("NJ USA") must agree with the
//  source's subdivision when both have one (stops "GLOUCESTER CITY, NJ"
//  landing on Gloucester, Virginia).
//
//  Measured on the 830 stored receipts (494 distinct port names): ~94%
//  placed before any manual override.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { DATA_FOLDER } = require("../config");
const { normKey, nameVariants } = require("./names");
const { updatePorts, PORTS_FILE } = require("./build-data");

const OVERRIDES_FILE = path.join(DATA_FOLDER, "route-map-overrides.json");

// Spellings Tradetech uses that the UN country list doesn't.
const COUNTRY_ALIASES = {
    "USA": "US", "U S A": "US", "US": "US", "UNITED STATES": "US",
    "UK": "GB", "UNITED KINGDOM": "GB", "ENGLAND": "GB", "SCOTLAND": "GB", "WALES": "GB", "NORTHERN IRELAND": "GB",
    "SOUTH KOREA": "KR", "KOREA SOUTH": "KR", "KOREA": "KR", "TAIWAN": "TW", "VIET NAM": "VN", "VIETNAM": "VN",
    "RUSSIA": "RU", "HONG KONG": "HK", "MACAO": "MO", "MACAU": "MO", "IRAN": "IR", "TURKEY": "TR", "TURKIYE": "TR",
    "HOLLAND": "NL", "NETHERLANDS": "NL", "CZECH REPUBLIC": "CZ", "BOLIVIA": "BO", "VENEZUELA": "VE", "TANZANIA": "TZ",
    "SYRIA": "SY", "IVORY COAST": "CI", "COTE D IVOIRE": "CI", "DOMINICAN REPUBLIC": "DO", "PHILIPPINES": "PH",
    "UNITED ARAB EMIRATES": "AE", "UAE": "AE", "SAUDI ARABIA": "SA", "PUERTO RICO": "PR", "NEW ZEALAND": "NZ",
    "PAPUA NEW GUINEA": "PG", "FRENCH POLYNESIA": "PF", "NEW CALEDONIA": "NC", "CONGO": "CG", "DEMOCRATIC CONGO": "CD",
    "CAPE VERDE": "CV", "BRUNEI": "BN", "LAOS": "LA", "MOLDOVA": "MD", "MICRONESIA": "FM", "SAINT LUCIA": "LC",
    "ST LUCIA": "LC", "GUAM": "GU", "EAST TIMOR": "TL", "SINT MAARTEN": "SX", "SINT MAARTEN DUTCH": "SX",
};

// Canals/straits Tradetech lists as rotation stops.
const WAYPOINTS = {
    "SUEZ CANAL": [30.6, 32.33], "PANAMA CANAL": [9.08, -79.68], "PANAMA CANAL CARIB": [9.35, -79.92],
    "PANAMA CANAL PACIF": [8.95, -79.57], "BOSPORUS": [41.12, 29.07], "DARDANELLES": [40.2, 26.4],
    "TORRES STRAIT": [-10.5, 142.2], "GIBRALTAR STRAIT": [35.97, -5.5], "MALACCA STRAIT": [2.5, 101.3],
};

let ports = null;    // the built index (build-data.js shape)
let overrides = {};  // { [tradetech name]: [lat, lon] }

async function ensureLoaded() {
    if (ports) return;
    if (fs.existsSync(PORTS_FILE)) ports = JSON.parse(fs.readFileSync(PORTS_FILE, "utf8"));
    else ports = await updatePorts(); // first use — fetch the sources once
    try { overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8")); } catch { overrides = {}; }
}

async function refreshPorts() {
    ports = await updatePorts();
}

function setOverride(name, lat, lon) {
    if (lat == null || lon == null) delete overrides[name];
    else overrides[name] = [Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000];
    fs.mkdirSync(DATA_FOLDER, { recursive: true });
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
}

// "LOS ANGELES, CA USA" -> { cc: "US", sub: "CA", cities: ["LOS ANGELES"] }
function parseName(name) {
    const parts = String(name).split(",").map(p => p.trim()).filter(Boolean);
    const countryPart = normKey(parts[parts.length - 1]);
    const lookup = (k) => COUNTRY_ALIASES[k] || ports.countries[k] || null;
    let cc = lookup(countryPart), sub = "";
    if (!cc) {
        const words = countryPart.split(" ");
        for (let i = 1; i < words.length && !cc; i++) {
            cc = lookup(words.slice(i).join(" "));
            if (cc) sub = words.slice(0, i).join(" ");
        }
    }
    const cities = parts.length > 1 ? [parts.slice(0, -1).join(", "), parts[0]] : [parts[0]];
    return { cc, sub, cities: [...new Set(cities)] };
}

const subOk = (sub, entrySub) => !sub || !entrySub || sub === entrySub;

// Loose match: the source name's words are all in ours ("MANILA" for
// "MANILA NORTH HARBOUR") — or ours are all in a source name, but only
// when exactly one such name exists in the country.
function looseMatch(cc, sub, key) {
    const want = key.split(" ");
    const country = ports.byName[cc] || {};
    let contained = null;
    const containing = [];
    for (const [k, entry] of Object.entries(country)) {
        if (!subOk(sub, entry[3])) continue;
        const have = k.split(" ");
        if (have.every(w => want.includes(w))) { if (!contained || entry[2] === "portwatch") contained = [k, entry]; }
        else if (want.every(w => have.includes(w))) containing.push([k, entry]);
    }
    if (contained) return contained;
    const uniqueSpots = new Set(containing.map(([, e]) => `${e[0]},${e[1]}`));
    return uniqueSpots.size === 1 ? containing[0] : null;
}

// -> { lat, lon, how: "override"|"exact"|"waypoint"|"code"|"approx", matched, source } | null
function locateOne({ name, code }) {
    if (!name) return null;
    if (overrides[name]) return { lat: overrides[name][0], lon: overrides[name][1], how: "override", matched: name, source: "manual" };

    const { cc, sub, cities } = parseName(name);
    const variants = cities.flatMap(nameVariants);

    // Before the datasets: UN/LOCODE's own "Suez Canal" entry sits at
    // 42.3°N (the Black Sea) — a known-good fixed point beats it.
    for (const v of variants) {
        if (WAYPOINTS[v]) return { lat: WAYPOINTS[v][0], lon: WAYPOINTS[v][1], how: "waypoint", matched: v, source: "built-in" };
    }
    if (cc) {
        for (const v of variants) {
            const e = ports.byName[cc]?.[v];
            if (e && subOk(sub, e[3])) return { lat: e[0], lon: e[1], how: "exact", matched: v, source: e[2] };
        }
    }
    if (cc && code) {
        const e = ports.byCode[cc + String(code).toUpperCase()];
        if (e && subOk(sub, e[3])) return { lat: e[0], lon: e[1], how: "code", matched: cc + code.toUpperCase(), source: e[2] };
    }
    if (cc) {
        for (const v of variants) {
            const hit = looseMatch(cc, sub, v);
            if (hit) return { lat: hit[1][0], lon: hit[1][1], how: "approx", matched: hit[0], source: hit[1][2] };
        }
    }
    return null;
}

async function locate(portList) {
    await ensureLoaded();
    return portList.map(locateOne);
}

module.exports = { locate, setOverride, refreshPorts, parseName };
