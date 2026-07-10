// ============================================================
//  routes/dashboard.js
//  Serves the dashboard's index.html / style.css / dashboard.js
//  straight from disk (dashboard/ folder). Reading from disk on
//  every request — rather than caching in memory at startup —
//  is a deliberate choice: it means editing the dashboard's
//  look or behavior just needs a browser refresh, no server
//  restart required.
// ============================================================

const fs   = require("fs");
const path = require("path");

const DASHBOARD_DIR = path.join(__dirname, "..", "dashboard");

function serveFile(res, filename, contentType) {
    try {
        const content = fs.readFileSync(path.join(DASHBOARD_DIR, filename), "utf8");
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
    } catch (err) {
        console.error(`❌ Could not read dashboard/${filename}:`, err.message);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Dashboard asset not found — check service-relay/dashboard/ exists.");
    }
}

function handleDashboardIndex(req, res) {
    serveFile(res, "index.html", "text/html");
}

function handleDashboardCss(req, res) {
    serveFile(res, "style.css", "text/css");
}

function handleDashboardJs(req, res) {
    serveFile(res, "dashboard.js", "application/javascript");
}

module.exports = { handleDashboardIndex, handleDashboardCss, handleDashboardJs };
