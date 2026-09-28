// ============================================================
//  routes/update-extension.js
//  POST /update-extension — git pull the extension's own repo, so the
//  toolbar's Update button can get fresh code without a manual
//  terminal step. Relay-only (needs shell access a content script
//  doesn't have).
//
//  Refuses to pull over uncommitted local changes rather than risk
//  clobbering them — "always commit and sync" is the normal workflow
//  here, so a dirty tree usually means mid-edit, not intentional.
// ============================================================

const path = require("path");
const { execFileSync } = require("child_process");

// service-relay/routes/ -> service-relay -> repo root
const REPO_ROOT = path.join(__dirname, "..", "..");

function git(args) {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

async function handlePull(req, res) {
    try {
        if (git(["status", "--porcelain"]).trim()) {
            return sendJson(res, 200, { ok: false, reason: "uncommitted local changes — commit or stash first, then try again" });
        }

        const before = git(["rev-parse", "HEAD"]).trim();
        let pullOutput;
        try {
            pullOutput = git(["pull", "--ff-only"]);
        } catch (err) {
            // Most likely a diverged/non-fast-forward history — surfaced
            // as-is rather than guessed at, since resolving it isn't
            // something this button should attempt on its own.
            return sendJson(res, 200, { ok: false, reason: (err.stderr || err.message || "git pull failed").toString().trim() });
        }
        const after = git(["rev-parse", "HEAD"]).trim();

        console.log(`🔄 Update Extension: ${before === after ? "already up to date" : `updated ${before.slice(0, 7)} → ${after.slice(0, 7)}`}`);
        sendJson(res, 200, {
            ok: true,
            updated: before !== after,
            commit: after.slice(0, 7),
            message: pullOutput.trim(),
        });
    } catch (err) {
        console.error("❌ Update Extension failed:", err);
        sendJson(res, 500, { ok: false, reason: err.message });
    }
}

module.exports = { handlePull };
