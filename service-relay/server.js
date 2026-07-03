// ============================================================
//  server.js — Service Code Relay (WebSocket Edition)
// ============================================================

const http      = require("http");
const WebSocket = require("ws");
const fs        = require("fs");
const path      = require("path");
const chokidar  = require("chokidar");

// ── State ────────────────────────────────────────────────────
let currentServiceCode = "";
let renamingEnabled    = true;
const PORT             = 3737;

const WATCH_FOLDER = "C:\\Users\\DELL\\Downloads";
const WATCH_EXTS   = [".jpg", ".jpeg", ".png", ".xlsx", ".xls", ".pdf"];

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
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: currentServiceCode }));
        return;
    }

    if (req.method === "GET" && req.url === "/renaming") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ enabled: renamingEnabled }));
        return;
    }

    // Find a downloaded proof file matching this service code + today's date.
    // Used by upload-proof.js before it opens the Support Document popup.
    if (req.method === "GET" && req.url.startsWith("/find-file")) {
        const urlObj  = new URL(req.url, `http://localhost:${PORT}`);
        const service = urlObj.searchParams.get("service");

        if (!service) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing service" }));
            return;
        }

        const today   = new Date();
        const mm      = String(today.getMonth() + 1).padStart(2, "0");
        const dd      = String(today.getDate()).padStart(2, "0");
        const yy      = String(today.getFullYear()).slice(-2);
        const dateStr = `${mm}${dd}${yy}`;

        const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`^${escaped}-${dateStr}(-\\d+)?\\.[a-z0-9]+$`, "i");

        const files = fs.readdirSync(WATCH_FOLDER).filter(f => pattern.test(f));

        console.log(`🔍 find-file: service=${service} date=${dateStr} → ${files.length} match(es)`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ files }));
        return;
    }

    // Stream a specific file's raw bytes back to the extension so it can be
    // wrapped in a File object and injected into Tradetech's file input.
    if (req.method === "GET" && req.url.startsWith("/file")) {
        const urlObj   = new URL(req.url, `http://localhost:${PORT}`);
        const name     = urlObj.searchParams.get("name");
        const safeName = name ? path.basename(name) : ""; // prevent path traversal
        const filePath = path.join(WATCH_FOLDER, safeName);

        if (!safeName || !fs.existsSync(filePath)) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "File not found" }));
            return;
        }

        console.log(`📤 Serving file: ${safeName}`);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    res.writeHead(404);
    res.end("Not found");
});

// ── WebSocket ────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on("connection", (ws) => {
    console.log("🔌 Client connected");

    ws.send(JSON.stringify({
        type:            "init",
        serviceCode:     currentServiceCode,
        renamingEnabled: renamingEnabled
    }));

    ws.on("message", (raw) => {
        try {
            const data = JSON.parse(raw);

            if (data.type === "service") {
                currentServiceCode = data.code;
                console.log("📥 Service code:", currentServiceCode);
                broadcast({ type: "service", code: currentServiceCode });
            }

            if (data.type === "renaming") {
                renamingEnabled = data.enabled;
                console.log("🔄 Renaming enabled:", renamingEnabled);
                broadcast({ type: "renaming", enabled: renamingEnabled });
            }

            if (data.type === "merge-download") {
                console.log("🖼 Merge download signal — cleanup in 3s");
                setTimeout(runMergeCleanup, 3000);
            }

        } catch (err) {
            console.error("❌ Bad message:", err);
        }
    });

    ws.on("close", () => {
        console.log("🔌 Client disconnected");
    });
});

// ── Merge Cleanup ────────────────────────────────────────────
function runMergeCleanup() {
    const today   = new Date();
    const mm      = String(today.getMonth() + 1).padStart(2, "0");
    const dd      = String(today.getDate()).padStart(2, "0");
    const yy      = String(today.getFullYear()).slice(-2);
    const dateStr = `${mm}${dd}${yy}`;

    console.log("🧹 Running merge cleanup...");

    const files = fs.readdirSync(WATCH_FOLDER);

    // STEP 1 — delete today's screencapture files
    files.forEach(file => {
        if (file.startsWith("screencapture-")) {
            const filePath = path.join(WATCH_FOLDER, file);
            const stat     = fs.statSync(filePath);
            const fileDate = new Date(stat.birthtime);

            const isToday =
                fileDate.getDate()     === today.getDate()     &&
                fileDate.getMonth()    === today.getMonth()    &&
                fileDate.getFullYear() === today.getFullYear();

            if (isToday) {
                fs.unlinkSync(filePath);
                console.log(`🗑 Deleted screencapture: ${file}`);
            }
        }
    });

    // STEP 2 — find numbered duplicates for current service + today
    const escaped = currentServiceCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
        `^${escaped}-${dateStr}-(\\d+)\\.(png|jpg|jpeg|xlsx|xls|pdf)$`, "i"
    );

    const numbered = [];
    files.forEach(file => {
        const match = file.match(pattern);
        if (match) numbered.push({ file, num: parseInt(match[1], 10), ext: match[2] });
    });

    if (numbered.length === 0) {
        console.log("🧹 No numbered duplicates found");
        return;
    }

    numbered.sort((a, b) => a.num - b.num);

    const highest = numbered[numbered.length - 1];

    // delete all lower numbered ones
    numbered.slice(0, -1).forEach(({ file }) => {
        fs.unlinkSync(path.join(WATCH_FOLDER, file));
        console.log(`🗑 Deleted duplicate: ${file}`);
    });

    // rename highest to clean name
    const cleanName = `${currentServiceCode}-${dateStr}.${highest.ext}`;
    const cleanPath = path.join(WATCH_FOLDER, cleanName);
    const highPath  = path.join(WATCH_FOLDER, highest.file);

    if (fs.existsSync(cleanPath)) {
        fs.unlinkSync(cleanPath);
        console.log(`🗑 Removed old clean file: ${cleanName}`);
    }

    fs.renameSync(highPath, cleanPath);
    console.log(`✅ Promoted ${highest.file} → ${cleanName}`);
}

// ── File Watcher ─────────────────────────────────────────────
const watcher = chokidar.watch(WATCH_FOLDER, {
    persistent:      true,
    ignoreInitial:   true,
    depth:           0,
    awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval:       100
    }
});

watcher.on("error", (err) => {
    console.error(`⚠ Watcher error (ignored, server keeps running): ${err.message}`);
});

watcher.on("add", (filePath) => {
    const ext      = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);

    // skip already renamed files
    if (/^.+-\d{6}(-\d+)?$/.test(basename)) {
        console.log(`⏭ Already renamed — skipping ${path.basename(filePath)}`);
        return;
    }

    if (!WATCH_EXTS.includes(ext)) return;

    if (!renamingEnabled) {
        console.log(`⏭ Renaming disabled — skipping ${path.basename(filePath)}`);
        return;
    }

    setTimeout(() => {
        const today   = new Date();
        const mm      = String(today.getMonth() + 1).padStart(2, "0");
        const dd      = String(today.getDate()).padStart(2, "0");
        const yy      = String(today.getFullYear()).slice(-2);
        const dateStr = `${mm}${dd}${yy}`;

        const newName = `${currentServiceCode}-${dateStr}${ext}`;
        const newPath = path.join(WATCH_FOLDER, newName);

        let finalPath = newPath;
        let counter   = 2;

        while (fs.existsSync(finalPath)) {
            finalPath = path.join(
                WATCH_FOLDER,
                `${currentServiceCode}-${dateStr}-${counter}${ext}`
            );
            counter++;
        }

        fs.rename(filePath, finalPath, (err) => {
            if (err) console.error("❌ Rename failed:", err);
            else     console.log(`✅ Renamed: ${path.basename(filePath)} → ${path.basename(finalPath)}`);
        });
    }, 300);
});

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`🚀 Service relay running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket ready on ws://localhost:${PORT}`);
    console.log(`👀 Watching Downloads folder: ${WATCH_FOLDER}`);
});