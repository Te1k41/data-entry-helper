// ============================================================
//  merge-cleanup.js
//  Triggered by MergeDownloadSignal (extension feature) after a
//  merged image is downloaded from mergeimagesonline.com: deletes
//  today's screencapture-* files, then collapses numbered
//  duplicate downloads down to a single clean file.
// ============================================================

const fs   = require("fs");
const path = require("path");
const { WATCH_FOLDER } = require("./config");
const relayState = require("./relay-state");

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
    const escaped = relayState.currentServiceCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const cleanName = `${relayState.currentServiceCode}-${dateStr}.${highest.ext}`;
    const cleanPath = path.join(WATCH_FOLDER, cleanName);
    const highPath  = path.join(WATCH_FOLDER, highest.file);

    if (fs.existsSync(cleanPath)) {
        fs.unlinkSync(cleanPath);
        console.log(`🗑 Removed old clean file: ${cleanName}`);
    }

    fs.renameSync(highPath, cleanPath);
    console.log(`✅ Promoted ${highest.file} → ${cleanName}`);
}

module.exports = { runMergeCleanup };
