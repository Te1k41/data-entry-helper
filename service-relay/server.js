// ============================================================
//  server.js — Service Code Relay (WebSocket Edition)
//  This file is just wiring: create the HTTP server, route
//  requests to the right handler module, attach the WebSocket
//  layer, and start the download watcher. All actual logic
//  lives in the modules it requires below.
// ============================================================

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

const relaySocket     = require("./relay-socket");
const downloadWatcher = require("./download-watcher");
const dueServicesStore = require("./due-services-store");
const scheduleGuidelineStore = require("./schedule-guideline-store");
const portDictionary = require("./port-dictionary");
const vesselDictionary = require("./vessel-dictionary");

dueServicesStore.loadFromDisk();
scheduleGuidelineStore.loadFromDisk();
portDictionary.loadFromDisk();
vesselDictionary.loadFromDisk();

// ── HTTP Server ──────────────────────────────────────────────
// Wrapped in try/catch so a bug in one route (a sync throw, not
// caught by that route's own async handler) returns a 500 instead
// of crashing the whole process and taking every other route with it.
const server = http.createServer((req, res) => {
    try {
        handleRequest(req, res);
    } catch (err) {
        console.error("❌ Unhandled route error:", err);
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        }
    }
});

function handleRequest(req, res) {
    res.setHeader("Access-Control-Allow-Origin",  "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "GET" && req.url === "/service") {
        return relayRoutes.handleGetService(req, res);
    }

    if (req.method === "GET" && req.url === "/renaming") {
        return relayRoutes.handleGetRenaming(req, res);
    }

    if (req.method === "GET" && req.url.startsWith("/find-file")) {
        return filesRoutes.handleFindFile(req, res);
    }

    if (req.method === "GET" && req.url.startsWith("/file")) {
        return filesRoutes.handleFile(req, res);
    }

    if (req.method === "POST" && req.url === "/proof/extract") {
        return proofExtractRoutes.handleExtract(req, res);
    }

    if (req.method === "POST" && req.url === "/proof/extract/confirm") {
        return proofExtractRoutes.handleConfirm(req, res);
    }

    if (req.method === "GET" && req.url.startsWith("/schedule-guideline")) {
        return scheduleGuidelineRoutes.handleGetGuideline(req, res);
    }

    if (req.method === "POST" && req.url === "/result/rebuild") {
        return resultRoutes.handleRebuild(req, res);
    }

    if (req.method === "POST" && req.url === "/port-dictionary/import") {
        return resultRoutes.handleImportMappings(req, res);
    }

    if (req.method === "GET" && req.url === "/result") {
        return resultRoutes.handleGetResult(req, res);
    }

    if (req.method === "POST" && req.url === "/due-services") {
        return dueServicesRoutes.handlePostDueServices(req, res);
    }

    if (req.method === "POST" && req.url === "/due-services/mark-done") {
        return dueServicesRoutes.handleMarkDone(req, res);
    }

    if (req.method === "POST" && req.url === "/due-services/undo-done") {
        return dueServicesRoutes.handleUndoDone(req, res);
    }

    if (req.method === "GET" && req.url === "/due-services") {
        return dueServicesRoutes.handleGetDueServices(req, res);
    }

    if (req.method === "GET" && req.url === "/due-services/current-batch") {
        return dueServicesRoutes.handleGetCurrentBatch(req, res);
    }

    if (req.method === "POST" && req.url === "/due-services/next-batch") {
        return dueServicesRoutes.handleNextBatch(req, res);
    }

    if (req.method === "POST" && req.url === "/due-services/previous-batch") {
        return dueServicesRoutes.handlePreviousBatch(req, res);
    }

    if (req.method === "POST" && req.url === "/due-services/go-to-day") {
        return dueServicesRoutes.handleGoToDay(req, res);
    }

    if (req.method === "POST" && req.url === "/due-services/recalculate-week") {
        return dueServicesRoutes.handleRecalculateWeek(req, res);
    }

    if (req.method === "GET" && req.url === "/due-services/history") {
        return dueServicesRoutes.handleGetHistory(req, res);
    }

    if (req.method === "GET" && req.url === "/due-services/activity") {
        return dueServicesRoutes.handleGetActivity(req, res);
    }

    if (req.method === "GET" && req.url.startsWith("/due-services/weekly-plan")) {
        return dueServicesRoutes.handleGetWeeklyPlan(req, res);
    }

    if (req.method === "GET" && req.url === "/dashboard") {
        return dashboardRoutes.handleDashboardIndex(req, res);
    }

    if (req.method === "GET" && req.url === "/dashboard/style.css") {
        return dashboardRoutes.handleDashboardCss(req, res);
    }

    if (req.method === "GET" && req.url === "/dashboard/dashboard.js") {
        return dashboardRoutes.handleDashboardJs(req, res);
    }

    if (req.method === "GET" && req.url === "/settings") {
        return settingsRoutes.handleGetSettings(req, res);
    }

    if (req.method === "POST" && req.url === "/settings") {
        return settingsRoutes.handlePostSettings(req, res);
    }

    if (req.method === "GET" && req.url === "/settings-page") {
        return dashboardRoutes.handleSettingsPage(req, res);
    }

    if (req.method === "GET" && req.url === "/dashboard/settings.js") {
        return dashboardRoutes.handleSettingsJs(req, res);
    }

    if (req.method === "GET" && req.url === "/dashboard/ports") {
        return dashboardRoutes.handlePortsPage(req, res);
    }

    if (req.method === "GET" && req.url === "/dashboard/ports.js") {
        return dashboardRoutes.handlePortsJs(req, res);
    }

    if (req.method === "POST" && req.url === "/port-dictionary/learn-batch") {
        return resultRoutes.handleLearnBatch(req, res);
    }

    if (req.method === "GET" && req.url === "/vessel-dictionary") {
        return vesselDictionaryRoutes.handleGetAll(req, res);
    }

    if (req.method === "POST" && req.url === "/vessel-dictionary/learn-batch") {
        return vesselDictionaryRoutes.handleLearnBatch(req, res);
    }

    if (req.method === "POST" && req.url === "/vessel-dictionary/remove") {
        return vesselDictionaryRoutes.handleRemove(req, res);
    }

    res.writeHead(404);
    res.end("Not found");
}

// ── WebSocket + Download Watcher ─────────────────────────────
relaySocket.init(server);
downloadWatcher.startWatcher();

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`🚀 Service relay running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket ready on ws://localhost:${PORT}`);
    console.log(`👀 Watching Downloads folder: ${WATCH_FOLDER}`);
});