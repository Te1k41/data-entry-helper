const fs = require("fs");
const path = require("path");

// Keep the temporary file beside its destination so renameSync stays on the
// same filesystem and is atomic. A unique suffix also prevents independent
// store writes from colliding when they happen close together.
//
// The rename-over-an-existing-destination step is retried a few times
// specifically for Windows: unlike POSIX, Windows can transiently refuse to
// replace a file that's momentarily open elsewhere (antivirus scan, another
// process reading it, Explorer's preview pane, etc.) with EPERM/EBUSY -- the
// lock is almost always gone again within a few hundred ms, so a short
// bounded retry recovers the write instead of losing it outright. Every
// call site here already wraps writeFileAtomicSync in its own try/catch
// that warns and moves on (see e.g. schedule-guideline-store.js) -- this
// still throws after retries exhaust, so that existing fallback is
// unchanged; the retry just means the common transient case never needs it.
const RETRY_DELAYS_MS = [20, 50, 150, 400];

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeFileAtomicSync(filePath, data, options) {
    const directory = path.dirname(filePath);
    const temporary = path.join(
        directory,
        `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    );

    const cleanupTemp = () => {
        try {
            fs.rmSync(temporary, { force: true });
        } catch {
            // Preserve the original write/rename failure.
        }
    };

    try {
        fs.writeFileSync(temporary, data, options);
    } catch (err) {
        cleanupTemp();
        throw err;
    }

    for (let attempt = 0; ; attempt++) {
        try {
            fs.renameSync(temporary, filePath);
            return;
        } catch (err) {
            const retryable = err.code === "EPERM" || err.code === "EBUSY";
            if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
                cleanupTemp();
                throw err;
            }
            sleepSync(RETRY_DELAYS_MS[attempt]);
        }
    }
}

module.exports = { writeFileAtomicSync };
