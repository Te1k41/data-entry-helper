// ============================================================
//  routes/route-map.js — data for the Route Map page
//  (dashboard/route-map.html). Private/relay-only for now.
//
//    GET  /route-map/receipts            receipt PNGs in RECEIPTS_FOLDER, newest first
//    GET  /route-map/receipt?file=NAME   one of those -> route + placed ports
//    POST /route-map/parse {dataUrl}     a dropped/picked receipt PNG -> same
//    POST /route-map/override {name, lat, lon}   remember a manual placement
//                                        (lat/lon null = forget it)
//    POST /route-map/update-ports        re-fetch the port sources
//    GET  /route-map/land.json           world outlines
//
//  Route data comes from the receipt itself (tEXt chunk written by
//  src/utils/receipt-data-relay.js). Receipts made before that have no
//  data — for those the relay's stored Highlight Review item for the
//  same service is used instead (ports, keys, operator; no carriers).
// ============================================================

const fs   = require("fs");
const path = require("path");
const { RECEIPTS_FOLDER } = require("../config");
const { readJsonBody } = require("../read-json-body");
const highlightReviewStore = require("../highlight-review-store");
const { locate, setOverride, refreshPorts } = require("../route-map/locate");

const KEYWORD = "TTHelper-Receipt"; // same as ReceiptData.KEYWORD
const LAND_FILE = path.join(__dirname, "..", "route-map", "data", "land.json");

function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

// PNG bytes -> embedded route data, or null.
function extractReceiptData(buf) {
    for (let pos = 8; pos + 12 <= buf.length;) {
        const len  = buf.readUInt32BE(pos);
        const type = buf.toString("latin1", pos + 4, pos + 8);
        if (type === "tEXt") {
            const body = buf.subarray(pos + 8, pos + 8 + len);
            const sep = body.indexOf(0);
            if (body.toString("latin1", 0, sep) === KEYWORD) {
                try { return JSON.parse(Buffer.from(body.toString("latin1", sep + 1), "base64").toString("utf8")); } catch { return null; }
            }
        }
        if (type === "IEND") break;
        pos += 12 + len;
    }
    return null;
}

// "AL5-W-100226-receipt.png" -> the stored review item for AL5-W, as
// receipt-data shaped route data.
function fromReviewStore(file) {
    const m = file.match(highlightReviewStore.RECEIPT_NAME);
    if (!m) return null;
    const item = highlightReviewStore.getAll().find(i => (i.serviceKey || i.key) === m[1] && i.ports?.length);
    if (!item) return null;
    return {
        v: 1,
        service: item.service,
        vesselOperator: { code: item.vesselOperator || "", name: "" },
        carriers: [],
        ports: item.ports.map(({ row, code, name, key, arrival, depart }) => ({ row, code, name, key, arrival, depart })),
        highlightedRow: highlightReviewStore.effectiveAuto(item),
    };
}

async function respondWithRoute(res, data, source) {
    if (!data?.ports?.length) {
        return sendJson(res, 200, { ok: false, reason: "This receipt has no route data — it was made before receipts carried it, and no stored review data matches its service. Re-save or re-capture it." });
    }
    const places = await locate(data.ports);
    sendJson(res, 200, { ok: true, source, data, places });
}

function handleList(req, res) {
    let files = [];
    try {
        files = fs.readdirSync(RECEIPTS_FOLDER)
            .filter(f => /-receipt\.png$/i.test(f))
            .map(f => ({ file: f, mtime: fs.statSync(path.join(RECEIPTS_FOLDER, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
    } catch { /* folder doesn't exist yet — nothing captured */ }
    sendJson(res, 200, { folder: RECEIPTS_FOLDER, files });
}

async function handleReceipt(req, res) {
    const file = path.basename(new URL(req.url, "http://localhost").searchParams.get("file") || ""); // basename: no path traversal
    let buf;
    try { buf = fs.readFileSync(path.join(RECEIPTS_FOLDER, file)); } catch { return sendJson(res, 404, { ok: false, reason: `No receipt named ${file}` }); }
    const embedded = extractReceiptData(buf);
    if (embedded) return respondWithRoute(res, embedded, "receipt");
    return respondWithRoute(res, fromReviewStore(file), "review-store");
}

async function handleParse(req, res) {
    const { dataUrl, filename } = await readJsonBody(req, { maxBytes: 20 * 1024 * 1024 });
    const m = typeof dataUrl === "string" && dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return sendJson(res, 400, { ok: false, reason: "Not a PNG receipt" });
    const embedded = extractReceiptData(Buffer.from(m[1], "base64"));
    if (embedded) return respondWithRoute(res, embedded, "receipt");
    return respondWithRoute(res, filename ? fromReviewStore(path.basename(filename)) : null, "review-store");
}

async function handleOverride(req, res) {
    const { name, lat, lon } = await readJsonBody(req);
    if (!name) return sendJson(res, 400, { ok: false, reason: "name required" });
    const valid = typeof lat === "number" && typeof lon === "number" && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    setOverride(String(name), valid ? lat : null, valid ? lon : null);
    sendJson(res, 200, { ok: true });
}

async function handleUpdatePorts(req, res) {
    try {
        await refreshPorts();
        sendJson(res, 200, { ok: true });
    } catch (err) {
        sendJson(res, 200, { ok: false, reason: err.message });
    }
}

function handleLand(req, res) {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "max-age=86400" });
    fs.createReadStream(LAND_FILE).pipe(res);
}

module.exports = { handleList, handleReceipt, handleParse, handleOverride, handleUpdatePorts, handleLand, extractReceiptData };
