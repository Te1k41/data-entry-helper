// ============================================================
//  download-watcher.js
//  Watches the Downloads folder with chokidar and auto-renames
//  new matching files to {SERVICE_CODE}-{MMDDYY}.{ext} (with a
//  -2, -3, ... suffix on repeat downloads the same day).
// ============================================================

const fs       = require("fs");
const path     = require("path");
const chokidar = require("chokidar");
const { WATCH_FOLDER, WATCH_EXTS } = require("./config");
const relayState = require("./relay-state");
const { extractAndSave } = require("./proof-extract");
const { parseYangMingHtmlFile } = require("./proof-parsers/yangming-html");
const { parseEvergreenHtmlFile } = require("./proof-parsers/evergreen-html");
const scheduleDomScrapeStore = require("./schedule-dom-scrape-store");

// Every saved-HTML parser returns the same { service, directions: [{
// direction, rows }, ...] } shape (see yangming-html.js's own header
// comment) -- tried in order, first one that doesn't throw wins. Add a new
// operator's HTML parser here as the list grows; nothing else in this file
// needs to change.
const HTML_PARSERS = [
    { operator: "YML", parse: parseYangMingHtmlFile },
    { operator: "EVG", parse: parseEvergreenHtmlFile },
];

async function parseHtmlWithAnyParser(filePath) {
    const errors = [];
    for (const { operator, parse } of HTML_PARSERS) {
        try {
            const result = await parse(filePath);
            return { operator, ...result };
        } catch (err) {
            errors.push(`${operator}: ${err.message}`);
        }
    }
    throw new Error(errors.join("; "));
}

// Shared by both the HTML and the generic (PNG/PDF/etc.) branches below --
// the exact same {service}-{MMDDYY}{ext} naming, with a -2, -3, ... suffix
// on repeat downloads the same day. Only ONE rename convention in this
// file, not two parallel ones.
function renameToServiceDate(filePath, service, ext) {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const yy = String(today.getFullYear()).slice(-2);
    const dateStr = `${mm}${dd}${yy}`;

    let finalPath = path.join(WATCH_FOLDER, `${service}-${dateStr}${ext}`);
    let counter = 2;
    while (fs.existsSync(finalPath)) {
        finalPath = path.join(WATCH_FOLDER, `${service}-${dateStr}-${counter}${ext}`);
        counter++;
    }

    return renameWithRetry(filePath, finalPath).then(() => finalPath);
}

// A just-downloaded file can still be transiently held open for a moment
// (the browser itself, or an antivirus scan on Windows) right when chokidar
// fires its "add" event -- fs.rename on the SOURCE file fails with
// EPERM/EBUSY in that window even though the destination path is already
// confirmed free (renameToServiceDate only ever picks a name that doesn't
// exist yet). Same short bounded retry as atomic-write.js's Windows lock
// handling, but async here since this call site already is.
const RENAME_RETRY_DELAYS_MS = [50, 150, 400, 1000];

function renameWithRetry(from, to, attempt = 0) {
    return new Promise((resolve, reject) => {
        fs.rename(from, to, (err) => {
            if (!err) { resolve(); return; }

            const retryable = err.code === "EPERM" || err.code === "EBUSY";
            if (!retryable || attempt >= RENAME_RETRY_DELAYS_MS.length) {
                reject(err);
                return;
            }
            setTimeout(() => {
                renameWithRetry(from, to, attempt + 1).then(resolve, reject);
            }, RENAME_RETRY_DELAYS_MS[attempt]);
        });
    });
}

function startWatcher() {
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

        // Snapshot the service code THE MOMENT the file is detected, not
        // later inside the async parse/rename chain below -- that chain
        // can take seconds (HTML parsing, on-demand OCR), during which
        // another tab could send a different service code and overwrite
        // relayState.currentServiceCode out from under this download.
        // Doesn't fully solve true concurrent multi-tab downloads (that
        // needs per-download intent correlation from the client), but it
        // closes by far the largest part of the race window.
        const serviceAtDownload = relayState.currentServiceCode;

        // skip already renamed files
        if (/^.+-\d{6}(-\d+)?$/.test(basename)) {
            console.log(`⏭ Already renamed — skipping ${path.basename(filePath)}`);
            return;
        }

        if (!WATCH_EXTS.includes(ext)) return;

        // Real bug, caught by the user: this used to key the file by the
        // operator's OWN service name parsed from the page (e.g. Yang
        // Ming's "TAIWAN") AND invent a separate naming scheme with a
        // direction suffix baked in ("PR5-E-090126.html") -- neither was
        // needed. /fill-test/run looks up DOM-scrape data by
        // guideline.service, which is TRADETECH's own service code (e.g.
        // "PR5"), so relayState.currentServiceCode is the only correct key
        // -- exactly the same source of truth the PNG proof screenshot is
        // already named/matched by. And direction never needed to be IN
        // the filename at all -- it's read from the file's own content for
        // the store's merge logic regardless of what the file is called.
        // Same rename convention as every other proof, via
        // renameToServiceDate() below, nothing HTML-specific about it.
        // Every parser in HTML_PARSERS is tried in turn (see its own
        // comment above) -- a file that matches none of them (parse
        // failure) just falls through and is left alone, same as before.
        if (ext === ".html" || ext === ".htm") {
            setTimeout(() => {
                parseHtmlWithAnyParser(filePath)
                    .then(({ operator, directions }) => {
                        const service = serviceAtDownload;
                        if (!service) {
                            console.warn(`⚠ ${path.basename(filePath)} parsed but no current service code is set — leaving un-renamed`);
                            return;
                        }
                        // A single save can carry more than one direction
                        // (confirmed real for Evergreen -- see
                        // evergreen-html.js) -- merge each one in turn
                        // rather than assuming exactly one per file.
                        for (const { direction, rows } of directions) {
                            scheduleDomScrapeStore.recordDirectionScrape(service, operator, direction, rows);
                        }
                        return renameToServiceDate(filePath, service, ext);
                    })
                    .then(finalPath => {
                        if (finalPath) console.log(`✅ Renamed: ${path.basename(filePath)} → ${path.basename(finalPath)}`);
                    })
                    .catch(err => {
                        console.warn(`⚠ ${path.basename(filePath)} is not a recognized schedule page — leaving as-is: ${err.message}`);
                    });
            }, 300);
            return;
        }

        if (!relayState.renamingEnabled) {
            console.log(`⏭ Renaming disabled — skipping ${path.basename(filePath)}`);
            return;
        }

        if (!serviceAtDownload) {
            console.warn(`⚠ ${path.basename(filePath)} downloaded but no current service code is set — leaving un-renamed`);
            return;
        }

        setTimeout(() => {
            renameToServiceDate(filePath, serviceAtDownload, ext)
                .then(finalPath => {
                    console.log(`✅ Renamed: ${path.basename(filePath)} → ${path.basename(finalPath)}`);

                    // Best-effort — a proof that fails to parse (wrong operator
                    // parser, unsupported type, no active guideline yet) must
                    // never break renaming for the next file in the queue.
                    extractAndSave(finalPath)
                        .then(({ service, vessels }) => {
                            console.log(`📄 Auto-extracted proof for ${service}: ${vessels} vessel(s) → extracted-proofs.xlsx`);
                        })
                        .catch(err => {
                            console.warn(`⚠ Auto-extract skipped for ${path.basename(finalPath)}: ${err.message}`);
                        });
                })
                .catch(err => console.error("❌ Rename failed:", err));
        }, 300);
    });

    return watcher;
}

module.exports = { startWatcher };
