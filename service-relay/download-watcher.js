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

        // skip already renamed files
        if (/^.+-\d{6}(-\d+)?$/.test(basename)) {
            console.log(`⏭ Already renamed — skipping ${path.basename(filePath)}`);
            return;
        }

        if (!WATCH_EXTS.includes(ext)) return;

        if (!relayState.renamingEnabled) {
            console.log(`⏭ Renaming disabled — skipping ${path.basename(filePath)}`);
            return;
        }

        setTimeout(() => {
            const today   = new Date();
            const mm      = String(today.getMonth() + 1).padStart(2, "0");
            const dd      = String(today.getDate()).padStart(2, "0");
            const yy      = String(today.getFullYear()).slice(-2);
            const dateStr = `${mm}${dd}${yy}`;

            const newName = `${relayState.currentServiceCode}-${dateStr}${ext}`;
            const newPath = path.join(WATCH_FOLDER, newName);

            let finalPath = newPath;
            let counter   = 2;

            while (fs.existsSync(finalPath)) {
                finalPath = path.join(
                    WATCH_FOLDER,
                    `${relayState.currentServiceCode}-${dateStr}-${counter}${ext}`
                );
                counter++;
            }

            fs.rename(filePath, finalPath, (err) => {
                if (err) console.error("❌ Rename failed:", err);
                else     console.log(`✅ Renamed: ${path.basename(filePath)} → ${path.basename(finalPath)}`);
            });
        }, 300);
    });

    return watcher;
}

module.exports = { startWatcher };
