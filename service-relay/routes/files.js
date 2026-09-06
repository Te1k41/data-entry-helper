// ============================================================
//  routes/files.js — GET /find-file, GET /file, GET /open-file,
//                     POST /kill-process
//  /find-file + /file are used by upload-proof.js to find and fetch
//  today's proof file for a given service code before staging it into
//  Tradetech's Support Document upload input.
//  /open-file + /kill-process are used by schedule-preview-tools.js to
//  open a proof file directly in its associated native app (instead of
//  a browser tab/download) and best-effort close it again after
//  Mark Done.
// ============================================================

const fs                    = require("fs");
const path                  = require("path");
const { spawn, execFileSync } = require("child_process");
const { WATCH_FOLDER, PORT } = require("../config");
const { readJsonBody } = require("../read-json-body");

// Filenames WE opened via /open-file, so /kill-process can only ever be
// used to close a file this server itself just opened — not an
// arbitrary path supplied by whatever called the endpoint.
const openedFiles = new Set();

// Finds every currently-running process with this exact absolute file
// path in its command line — i.e. the real viewer app, however it
// actually ended up running. Needed because the opener (xdg-open/open/
// start) is only a thin launcher: on Linux, confirmed by hand, xdg-open
// hands the file to the real viewer (e.g. gwenview) and exits within
// ~1s, and that viewer is NOT even a child process of xdg-open — so
// tracking the opener's own pid was killing an already-dead process
// and leaving the real viewer untouched. Searching by file path instead
// finds whatever process actually has it open, regardless of how many
// hops the launcher took to get there. This repo's drive gets opened
// from both Windows and Linux machines (see settings-store.js), so all
// three platforms get a real implementation, not just Linux.
function findPidsByFilePath(filePath) {
    if (process.platform === "win32") return findPidsByFilePathWindows(filePath);
    if (process.platform === "darwin") return findPidsByFilePathViaPs(filePath); // macOS has `ps` natively
    return findPidsByFilePathViaProc(filePath); // Linux — /proc, no subprocess needed
}

function findPidsByFilePathViaProc(filePath) {
    try {
        return fs.readdirSync("/proc")
            .filter(entry => /^\d+$/.test(entry))
            .filter(pid => {
                try {
                    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(filePath);
                } catch {
                    return false; // process exited mid-scan, or unreadable
                }
            })
            .map(Number);
    } catch {
        return [];
    }
}

function findPidsByFilePathViaPs(filePath) {
    try {
        const out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
        return out.split("\n")
            .filter(line => line.includes(filePath))
            .map(line => parseInt(line.trim(), 10))
            .filter(pid => !Number.isNaN(pid));
    } catch {
        return [];
    }
}

// No /proc, no `ps` on Windows — ask WMI (via PowerShell's CIM cmdlets,
// the modern non-deprecated way in) for every process whose command
// line contains this path. .Contains() is a plain substring check, not
// a wildcard match, so nothing in the path needs glob-escaping — only
// single quotes need doubling for PowerShell's single-quoted string
// literal syntax.
function findPidsByFilePathWindows(filePath) {
    const escaped  = filePath.replace(/'/g, "''");
    const psScript = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | Select-Object -ExpandProperty ProcessId`;

    try {
        const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], { encoding: "utf8" });
        return out.split(/\r?\n/)
            .map(line => parseInt(line.trim(), 10))
            .filter(pid => !Number.isNaN(pid));
    } catch {
        return [];
    }
}

// Hands a file off to its OS-associated app. This is always just a thin
// launcher — confirmed by hand on this machine, xdg-open exits within
// ~1s of handing an image off to gwenview, and gwenview isn't even a
// child process of it. /kill-process below doesn't rely on this
// process's pid at all because of that — see findPidsByFilePath.
// stderr is piped (not ignored) so handleOpenFile can surface a real
// error message — e.g. "no default handler" — instead of always
// reporting success regardless of whether anything actually opened.
function spawnOpener(filePath) {
    if (process.platform === "win32") {
        // "start" is a cmd.exe built-in, not a standalone executable —
        // must go through cmd.exe. The empty "" arg is required: without
        // it, `start` treats the first quoted argument as the window
        // title instead of the path to open.
        return spawn("cmd.exe", ["/c", "start", "", filePath], { detached: true, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    }
    if (process.platform === "darwin") {
        return spawn("open", [filePath], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
    }
    return spawn("xdg-open", [filePath], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
}

// Find a downloaded proof file matching this service code. By default only
// today's date matches (what upload-proof.js relies on — today's proof is
// the only one that should ever get auto-staged for upload). Pass
// anyDate=1 to match this service code on ANY date instead (used by
// schedule-preview-tools.js, where the proof could've been downloaded on
// an earlier day) — results are then sorted newest-file-first by actual
// mtime, since MMDDYY string-sorts wrong across a year boundary.
function handleFindFile(req, res) {
    const urlObj  = new URL(req.url, `http://localhost:${PORT}`);
    const service = urlObj.searchParams.get("service");
    const anyDate = urlObj.searchParams.get("anyDate") === "1";

    if (!service) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing service" }));
        return;
    }

    const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let pattern;
    let dateStr = "any";

    if (anyDate) {
        pattern = new RegExp(`^${escaped}-\\d{6}(-\\d+)?\\.[a-z0-9]+$`, "i");
    } else {
        const today = new Date();
        const mm    = String(today.getMonth() + 1).padStart(2, "0");
        const dd    = String(today.getDate()).padStart(2, "0");
        const yy    = String(today.getFullYear()).slice(-2);
        dateStr     = `${mm}${dd}${yy}`;
        pattern     = new RegExp(`^${escaped}-${dateStr}(-\\d+)?\\.[a-z0-9]+$`, "i");
    }

    let files = fs.readdirSync(WATCH_FOLDER).filter(f => pattern.test(f));

    if (anyDate) {
        files = files
            .map(f => ({ f, mtimeMs: fs.statSync(path.join(WATCH_FOLDER, f)).mtimeMs }))
            .sort((a, b) => b.mtimeMs - a.mtimeMs)
            .map(({ f }) => f);
    }

    console.log(`🔍 find-file: service=${service} date=${dateStr} → ${files.length} match(es)`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ files }));
}

// Stream a specific file's raw bytes back to the extension so it can be
// wrapped in a File object and injected into Tradetech's file input.
function handleFile(req, res) {
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
}

const OPEN_TIMEOUT_MS = 3000;

// Opens a file directly in its OS-associated app (image viewer,
// LibreOffice, etc.) — no browser tab, no download prompt. Waits
// (briefly) for the opener itself to exit so a genuine, FAST failure
// (e.g. no application registered at all for this file type — confirmed
// by hand, xdg-open exits immediately with code 4 for that) can be
// reported back instead of always claiming success. But it does NOT
// wait indefinitely: also confirmed by hand, xdg-open can instead hang
// waiting on a desktop "choose an application" dialog for an
// unassociated file type — the user would see and can act on that
// directly, so past OPEN_TIMEOUT_MS this just optimistically reports
// success rather than leaving the button looking stuck forever.
function handleOpenFile(req, res) {
    const urlObj   = new URL(req.url, `http://localhost:${PORT}`);
    const name     = urlObj.searchParams.get("name");
    const safeName = name ? path.basename(name) : ""; // prevent path traversal
    const filePath = path.join(WATCH_FOLDER, safeName);

    if (!safeName || !fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
        return;
    }

    const child  = spawnOpener(filePath);
    child.unref();
    let stderr    = "";
    let responded = false;
    if (child.stderr) child.stderr.on("data", chunk => { stderr += chunk; });

    const timeout = setTimeout(() => {
        if (responded) return;
        responded = true;
        openedFiles.add(filePath); // still worth trying to close later, whatever this turns out to be
        console.log(`🖼 Opened ${safeName} (still running past ${OPEN_TIMEOUT_MS}ms — likely a slow app or a desktop dialog on your screen)`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
    }, OPEN_TIMEOUT_MS);

    child.on("error", (err) => {
        if (responded) return;
        responded = true;
        clearTimeout(timeout);
        console.error(`❌ Could not open ${safeName}:`, err.message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: err.message }));
    });

    child.on("exit", (code) => {
        if (responded) return;
        responded = true;
        clearTimeout(timeout);

        if (code === 0) {
            openedFiles.add(filePath);
            console.log(`🖼 Opened ${safeName} (platform ${process.platform})`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
        } else {
            // Common cause: no application registered for this file's
            // type at all (confirmed by hand — xdg-open exits 4 with no
            // default handler installed, e.g. no spreadsheet app for
            // .xlsx). Nothing opened, so there's nothing to track/close.
            const message = stderr.trim() || `opener exited with code ${code} — is an app installed for this file type?`;
            console.error(`❌ Could not open ${safeName}: ${message}`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: message }));
        }
    });
}

const KILL_POLL_INTERVAL_MS = 200;
const KILL_POLL_TIMEOUT_MS  = 3000;

// Repeatedly searches for + tries to kill the real viewer, instead of a
// single instantaneous scan. Needed because of a real race confirmed by
// hand: xdg-open's OWN short-lived internal helper commands (mime
// detection etc.) also carry this file path in their argv and exit
// within milliseconds, while the actual viewer (e.g. gwenview) can take
// up to ~1.5s to actually launch. A scan that runs too early can match
// only those already-dead helpers (killing them is a harmless no-op —
// ESRCH) and report a false "closed" while the real viewer stays open.
// Polling until a kill genuinely succeeds (not just ESRCH) means it
// still catches the real viewer whenever it eventually shows up within
// the window; giving up after the timeout means genuinely-nothing-open
// (e.g. no application installed at all for this file type) doesn't
// hang the request.
function pollAndKill(filePath) {
    return new Promise((resolve) => {
        const start = Date.now();

        function tick() {
            const pids = findPidsByFilePath(filePath);
            let killedAny = false;

            for (const pid of pids) {
                try {
                    process.kill(pid, "SIGTERM");
                    console.log(`🛑 Closed pid ${pid}`);
                    killedAny = true;
                } catch (err) {
                    if (err.code !== "ESRCH") console.error(`❌ Could not close pid ${pid}:`, err.message);
                    // ESRCH = already exited on its own (most likely one of
                    // xdg-open's own transient helpers) — keep polling.
                }
            }

            if (killedAny) return resolve(true);
            if (Date.now() - start >= KILL_POLL_TIMEOUT_MS) return resolve(false);
            setTimeout(tick, KILL_POLL_INTERVAL_MS);
        }

        tick();
    });
}

// Best-effort close of a file opened via /open-file. Only accepts a
// filename this server actually opened.
async function handleKillProcess(req, res) {
    let name;
    try {
        name = (await readJsonBody(req)).name;
    } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
    }

        const safeName = name ? path.basename(name) : "";
        const filePath = path.join(WATCH_FOLDER, safeName);

        if (!safeName || !openedFiles.has(filePath)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unknown file" }));
            return;
        }

        openedFiles.delete(filePath);

        const closed = await pollAndKill(filePath);
        if (!closed) console.warn(`⚠ No running process found with ${safeName} open (waited ${KILL_POLL_TIMEOUT_MS}ms)`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, closed: closed ? 1 : 0 }));
}

module.exports = { handleFindFile, handleFile, handleOpenFile, handleKillProcess };
