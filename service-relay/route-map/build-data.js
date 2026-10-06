// ============================================================
//  route-map/build-data.js — fetch + rebuild the Route Map's data
//
//    node service-relay/route-map/build-data.js
//
//  Writes:
//    <DATA_FOLDER>/route-map-ports.json — port coordinates indexed for
//      locate.js (~8 MB, so NOT committed: built on first use by the
//      relay and refreshed from the Route Map page's "Update port data"
//      button — or by running this script)
//    route-map/data/land.json, borders.json — world land outlines and
//      country border lines for the map background (static, committed)
//
//  Sources (all free/open, fetched live):
//    - IMF PortWatch ports database (~2,000 ports: name, country,
//      coordinates, UN/LOCODE) — the main source, port-accurate coords
//    - UN/LOCODE (datasets/un-locode mirror of the UNECE list) — names
//      and coordinates for everything PortWatch lacks; port entries
//      first, then any location with coordinates (a city is close
//      enough to its port at map scale)
//    - Natural Earth 50m land + land country borders (public domain) — the map itself
//
//  Tradetech's own 3-letter port codes are often NOT UN/LOCODEs
//  (Shanghai is "SHA" in Tradetech, CNSHG in UN/LOCODE — CNSHA is the
//  airport), so ports are matched by NAME + COUNTRY, code only as a late
//  fallback — see locate.js.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { normKey, nameVariants } = require("./names");
const { DATA_FOLDER } = require("../config");

const OUT_DIR = path.join(__dirname, "data");
const PORTS_FILE = path.join(DATA_FOLDER, "route-map-ports.json");
const PORTWATCH = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/PortWatch_ports_database/FeatureServer/0/query";
const LOCODE_CSV  = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv";
const COUNTRY_CSV = "https://raw.githubusercontent.com/datasets/un-locode/main/data/country-codes.csv";
const LAND_GEOJSON = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson";
const BORDERS_GEOJSON = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson";

async function get(url, as = "text") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return as === "json" ? res.json() : res.text();
}

// Minimal RFC 4180 CSV parser (quoted fields, doubled quotes).
function parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c !== '"') field += c;
            else if (text[i + 1] === '"') { field += '"'; i++; }
            else quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
        else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

// UN/LOCODE "3114N 12129E" -> [31.233, 121.483]
function locodeCoord(s) {
    const m = /^(\d{2})(\d{2})([NS]) (\d{3})(\d{2})([EW])$/.exec(s || "");
    if (!m) return null;
    const lat = (+m[1] + m[2] / 60) * (m[3] === "S" ? -1 : 1);
    const lon = (+m[4] + m[5] / 60) * (m[6] === "W" ? -1 : 1);
    return [round(lat, 3), round(lon, 3)];
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

async function fetchPortWatch() {
    const all = [];
    for (let offset = 0; ; offset += 1000) {
        const url = `${PORTWATCH}?where=1%3D1&outFields=portname,country,lat,lon,LOCODE&returnGeometry=false&orderByFields=ObjectId&resultOffset=${offset}&resultRecordCount=1000&f=json`;
        const page = await get(url, "json");
        all.push(...page.features.map(f => f.attributes));
        if (!page.exceededTransferLimit && page.features.length < 1000) return all;
    }
}

async function buildPorts() {
    const [portwatch, locodeText, countryText] = await Promise.all([fetchPortWatch(), get(LOCODE_CSV), get(COUNTRY_CSV)]);

    const countries = {}; // normalized country name -> ISO2
    for (const [cc, name] of parseCsv(countryText).slice(1)) {
        if (!cc) continue;
        countries[normKey(name)] = cc;
        countries[normKey(name.replace(/\(.*?\)/g, ""))] = cc;
    }

    // byName[ISO2][nameKey] = [lat, lon, source, subdivision]. First write
    // wins, so insertion order IS the priority: PortWatch, then UN/LOCODE
    // ports, then any UN/LOCODE location.
    const byName = {};
    const put = (cc, name, lat, lon, src, sub = "") => {
        for (const k of nameVariants(name)) {
            const country = (byName[cc] ||= {});
            if (!country[k]) country[k] = [round(lat, 3), round(lon, 3), src, sub];
        }
    };

    for (const p of portwatch) {
        const cc = (p.LOCODE || "").slice(0, 2) || countries[normKey(p.country)];
        if (cc && p.lat != null && p.lon != null) put(cc, p.portname, p.lat, p.lon, "portwatch");
    }

    const locode = parseCsv(locodeText).slice(1)
        .filter(r => r[2] && r[0] !== "X") // X = marked for deletion
        .map(([, cc, loc, name, nameAscii, sub, , fn, , , coords]) => ({ cc, loc, name: nameAscii || name, sub, isPort: fn?.[0] === "1", coord: locodeCoord(coords) }))
        .filter(r => r.coord);
    for (const r of locode) if (r.isPort) put(r.cc, r.name, ...r.coord, "locode-port", r.sub);
    for (const r of locode) if (!r.isPort) put(r.cc, r.name, ...r.coord, "locode-place", r.sub);

    // byCode["CN"+"SHA"] — UN/LOCODE code fallback (ports first).
    const byCode = {};
    for (const r of [...locode.filter(r => r.isPort), ...locode.filter(r => !r.isPort)]) {
        byCode[r.cc + r.loc] ||= [...r.coord, r.isPort ? "locode-port" : "locode-place", r.sub];
    }

    return { builtAt: new Date().toISOString(), countries, byName, byCode };
}

// [[lon,lat], ...] at 0.05° precision with consecutive near-duplicates
// dropped — map-scale detail at a fraction of the size.
function thin(line) {
    const out = [];
    for (const [lon, lat] of line) {
        const pt = [round(lon, 2), round(lat, 2)];
        const prev = out[out.length - 1];
        if (!prev || Math.abs(prev[0] - pt[0]) >= 0.05 || Math.abs(prev[1] - pt[1]) >= 0.05) out.push(pt);
    }
    return out;
}

// Natural Earth land -> outer+inner rings. They already stop at ±180°,
// so the map can draw the world 3× side by side to center any longitude
// without seams.
async function buildLand() {
    const geo = await get(LAND_GEOJSON, "json");
    const rings = [];
    for (const f of geo.features) {
        const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const ring of polys.flat()) {
            const out = thin(ring);
            if (out.length >= 4) rings.push(out);
        }
    }
    return rings;
}

// Country borders on land (no maritime lines) -> polylines.
async function buildBorders() {
    const geo = await get(BORDERS_GEOJSON, "json");
    const lines = [];
    for (const f of geo.features) {
        const parts = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const part of parts) {
            const out = thin(part);
            if (out.length >= 2) lines.push(out);
        }
    }
    return lines;
}

// Fetch + write the ports index; returns it. Used by the relay
// (first use / "Update port data") and by running this file.
async function updatePorts() {
    const ports = await buildPorts();
    fs.mkdirSync(DATA_FOLDER, { recursive: true });
    fs.writeFileSync(PORTS_FILE, JSON.stringify(ports));
    const names = Object.values(ports.byName).reduce((n, c) => n + Object.keys(c).length, 0);
    console.log(`✅ ${PORTS_FILE}: ${names} names in ${Object.keys(ports.byName).length} countries`);
    return ports;
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const [, land, borders] = await Promise.all([updatePorts(), buildLand(), buildBorders()]);
    fs.writeFileSync(path.join(OUT_DIR, "land.json"), JSON.stringify(land));
    fs.writeFileSync(path.join(OUT_DIR, "borders.json"), JSON.stringify(borders));
    console.log(`✅ land.json: ${land.length} rings, borders.json: ${borders.length} lines`);
}

module.exports = { updatePorts, PORTS_FILE };

if (require.main === module) {
    main().catch(err => { console.error("❌ build-data failed:", err); process.exit(1); });
}
