// ============================================================
//  server.js — Service Code Relay (WebSocket Edition)
//  This file is just wiring: create the HTTP server, route
//  requests to the right handler module, attach the WebSocket
//  layer, and start the download watcher. All actual logic
//  lives in the modules it requires below.
// ============================================================

// pdf-parse (used by proof-parsers) expects a browser-style DOMMatrix
// global; Node doesn't provide one, so polyfill it before anything
// requires pdf-parse.
if (typeof global.DOMMatrix === "undefined") {
    global.DOMMatrix = require("dommatrix");
}

const http = require("http");
const { PORT, WATCH_FOLDER } = require("./config");

const relayRoutes       = require("./routes/relay");
const filesRoutes       = require("./routes/files");
const dueServicesRoutes = require("./routes/due-services");
const dashboardRoutes   = require("./routes/dashboard");
const settingsRoutes    = require("./routes/settings");
const proofExtractRoutes = require("./routes/proof-extract");
const scheduleGuidelineRoutes = require("./routes/schedule-guideline");
const resultRoutes = require("./routes/result");
const vesselDictionaryRoutes = require("./routes/vessel-dictionary");
const fillTestRoutes = require("./routes/fill-test");

const relaySocket     = require("./relay-socket");
const downloadWatcher = require("./download-watcher");
const dueServicesStore = require("./due-services-store");
const scheduleGuidelineStore = require("./schedule-guideline-store");
const scheduleDomScrapeStore = require("./schedule-dom-scrape-store");
const portDictionary = require("./port-dictionary");
const vesselDictionary = require("./vessel-dictionary");

dueServicesStore.loadFromDisk();
scheduleGuidelineStore.loadFromDisk();
scheduleDomScrapeStore.loadFromDisk();
portDictionary.loadFromDisk();
vesselDictionary.loadFromDisk();

// ── HTTP Server ──────────────────────────────────────────────
// Routed through a Promise chain, not a plain try/catch -- most route
// handlers are async, and a plain synchronous try/catch here can only
// catch a throw that happens BEFORE the first `await` inside one of
// them; a rejection after that point would otherwise be an unhandled
// promise rejection (silently leaves the client hanging, and can crash
// the whole process depending on Node's config). Promise.resolve().then()
// catches a route's sync throw the same way try/catch did, AND its
// async rejections, in one place.
const server = http.createServer((req, res) => {
    Promise.resolve()
        .then(() => handleRequest(req, res))
        .catch(err => {
            console.error("❌ Unhandled route error:", err);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
});

// This server binds to 127.0.0.1 only (see server.listen below), so it's
// unreachable from the LAN. That still leaves ANY webpage open in the same
// browser able to fetch()/POST to it -- localhost is not origin-scoped.
// Background service-worker requests (background.js's own WebSocket/fetch
// calls) ARE exempt from CORS via the extension's host_permissions grant.
// Content-script fetch() calls are NOT exempt, though -- Chrome sends a
// real Origin header for those (confirmed live: a Tradetech content
// script's OPTIONS preflight to /due-services arrives with
// `Origin: https://www.tradetech.net`), so they need to be allowlisted
// explicitly here or their preflight gets no Access-Control-Allow-Origin
// and the browser silently blocks the real request afterward. These are
// exactly the origins this extension's content scripts make direct
// relay fetch() calls from (due-service-scanner.js, schedule-capture.js,
// service-relay-send.js, merge-download-signal.js) -- see manifest.json's
// content_scripts matches. The dashboard's own pages fetch same-origin,
// which browsers never gate on CORS, so this allowlist otherwise exists
// purely to deny an arbitrary website's own JS.
const ALLOWED_ORIGIN = `http://localhost:${PORT}`;
const ALLOWED_EXTENSION_ORIGINS = [
    "https://www.tradetech.net",
    "https://mergeimagesonline.com",
];

const exact = path => url => url === path;
const prefix = path => url => url.startsWith(path);

// Order is intentional and matches the former dispatch chain exactly.
// A few endpoints accept query strings and therefore retain prefix matching;
// every other endpoint remains an exact path match.
const ROUTES = [
    { method: "GET",  match: exact("/service"),                         handler: relayRoutes.handleGetService },
    { method: "GET",  match: exact("/renaming"),                        handler: relayRoutes.handleGetRenaming },
    { method: "GET",  match: prefix("/find-file"),                      handler: filesRoutes.handleFindFile },
    { method: "GET",  match: prefix("/file"),                           handler: filesRoutes.handleFile },
    { method: "GET",  match: prefix("/open-file"),                      handler: filesRoutes.handleOpenFile },
    { method: "POST", match: exact("/kill-process"),                    handler: filesRoutes.handleKillProcess },
    { method: "POST", match: exact("/proof/extract"),                   handler: proofExtractRoutes.handleExtract },
    { method: "POST", match: exact("/proof/extract/confirm"),           handler: proofExtractRoutes.handleConfirm },
    { method: "GET",  match: prefix("/schedule-guideline"),             handler: scheduleGuidelineRoutes.handleGetGuideline },
    { method: "POST", match: exact("/result/rebuild"),                  handler: resultRoutes.handleRebuild },
    { method: "POST", match: exact("/port-dictionary/import"),          handler: resultRoutes.handleImportMappings },
    { method: "GET",  match: exact("/result"),                          handler: resultRoutes.handleGetResult },
    { method: "POST", match: exact("/due-services"),                    handler: dueServicesRoutes.handlePostDueServices },
    { method: "POST", match: exact("/due-services/mark-done"),          handler: dueServicesRoutes.handleMarkDone },
    { method: "POST", match: exact("/due-services/undo-done"),          handler: dueServicesRoutes.handleUndoDone },
    { method: "GET",  match: exact("/due-services"),                    handler: dueServicesRoutes.handleGetDueServices },
    { method: "GET",  match: exact("/due-services/current-batch"),      handler: dueServicesRoutes.handleGetCurrentBatch },
    { method: "POST", match: exact("/due-services/next-batch"),         handler: dueServicesRoutes.handleNextBatch },
    { method: "POST", match: exact("/due-services/previous-batch"),     handler: dueServicesRoutes.handlePreviousBatch },
    { method: "POST", match: exact("/due-services/go-to-day"),          handler: dueServicesRoutes.handleGoToDay },
    { method: "POST", match: exact("/due-services/recalculate-week"),   handler: dueServicesRoutes.handleRecalculateWeek },
    { method: "GET",  match: exact("/due-services/history"),            handler: dueServicesRoutes.handleGetHistory },
    { method: "GET",  match: exact("/due-services/activity"),           handler: dueServicesRoutes.handleGetActivity },
    { method: "GET",  match: prefix("/due-services/weekly-plan"),       handler: dueServicesRoutes.handleGetWeeklyPlan },
    { method: "GET",  match: exact("/dashboard"),                       handler: dashboardRoutes.handleDashboardIndex },
    { method: "GET",  match: exact("/dashboard/style.css"),             handler: dashboardRoutes.handleDashboardCss },
    { method: "GET",  match: exact("/dashboard/dashboard.js"),          handler: dashboardRoutes.handleDashboardJs },
    { method: "GET",  match: exact("/settings"),                        handler: settingsRoutes.handleGetSettings },
    { method: "POST", match: exact("/settings"),                        handler: settingsRoutes.handlePostSettings },
    { method: "GET",  match: exact("/settings-page"),                   handler: dashboardRoutes.handleSettingsPage },
    { method: "GET",  match: exact("/dashboard/settings.js"),           handler: dashboardRoutes.handleSettingsJs },
    { method: "GET",  match: exact("/dashboard/ports"),                 handler: dashboardRoutes.handlePortsPage },
    { method: "GET",  match: exact("/dashboard/ports.js"),              handler: dashboardRoutes.handlePortsJs },
    { method: "GET",  match: exact("/dashboard/merge"),                 handler: dashboardRoutes.handleMergePage },
    { method: "GET",  match: exact("/dashboard/merge.js"),              handler: dashboardRoutes.handleMergeJs },
    { method: "GET",  match: exact("/dashboard/fill-test"),             handler: dashboardRoutes.handleFillTestPage },
    { method: "POST", match: exact("/fill-test/run"),                   handler: fillTestRoutes.handleFillTestRun },
    { method: "POST", match: exact("/port-dictionary/learn-batch"),     handler: resultRoutes.handleLearnBatch },
    { method: "GET",  match: exact("/vessel-dictionary"),               handler: vesselDictionaryRoutes.handleGetAll },
    { method: "POST", match: exact("/vessel-dictionary/learn-batch"),   handler: vesselDictionaryRoutes.handleLearnBatch },
    { method: "POST", match: exact("/vessel-dictionary/remove"),        handler: vesselDictionaryRoutes.handleRemove },
];

function handleRequest(req, res) {
    const origin = req.headers.origin;
    // Only echo back Access-Control-Allow-Origin for the dashboard's own
    // origin (or requests with no Origin header at all, e.g. same-origin
    // navigations and extension-privileged fetches) -- an arbitrary
    // website's cross-origin fetch/XHR sends its own Origin and gets no
    // CORS grant, so the browser blocks it before the mutating request
    // (or its response) can do anything.
    if (!origin || origin === ALLOWED_ORIGIN || ALLOWED_EXTENSION_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin || ALLOWED_ORIGIN);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    for (const route of ROUTES) {
        if (req.method === route.method && route.match(req.url)) {
            return route.handler(req, res);
        }
    }

    res.writeHead(404);
    res.end("Not found");
}

// ── WebSocket + Download Watcher ─────────────────────────────
relaySocket.init(server);
downloadWatcher.startWatcher();

// ── Start ────────────────────────────────────────────────────
// Bound to 127.0.0.1 explicitly -- omitting the host here defaults to ALL
// interfaces, which would expose this relay (file access, settings, due-
// service mutation, the whole WebSocket protocol) to the entire LAN.
server.listen(PORT, "127.0.0.1", () => {
    console.log(`🚀 Service relay running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket ready on ws://localhost:${PORT}`);
    console.log(`👀 Watching Downloads folder: ${WATCH_FOLDER}`);
});
