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

const relaySocket     = require("./relay-socket");
const downloadWatcher = require("./download-watcher");
const dueServicesStore = require("./due-services-store");

dueServicesStore.loadFromDisk();

// ── HTTP Server ──────────────────────────────────────────────
const server = http.createServer((req, res) => {
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

    if (req.method === "POST" && req.url === "/due-services") {
        return dueServicesRoutes.handlePostDueServices(req, res);
    }

    if (req.method === "POST" && req.url === "/due-services/mark-done") {
        return dueServicesRoutes.handleMarkDone(req, res);
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

    if (req.method === "GET" && req.url === "/due-services/history") {
        return dueServicesRoutes.handleGetHistory(req, res);
    }

    if (req.method === "GET" && req.url === "/due-services/activity") {
        return dueServicesRoutes.handleGetActivity(req, res);
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

    res.writeHead(404);
    res.end("Not found");
});

// ── WebSocket + Download Watcher ─────────────────────────────
relaySocket.init(server);
downloadWatcher.startWatcher();

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`🚀 Service relay running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket ready on ws://localhost:${PORT}`);
    console.log(`👀 Watching Downloads folder: ${WATCH_FOLDER}`);
});