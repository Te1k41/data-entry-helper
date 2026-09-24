// Relay state, content-script messages, and optional schedule HTML capture.
let renamingEnabled  = true;
let ws               = null;
let relayAvailable   = false;

// Set whenever a toggle click can't reach the server immediately (WS
// not open — mid-reconnect after a service-worker suspend, a network
// blip, a server restart). Without this, that click silently updates
// the local tabs/storage only, the server never learns about it, and
// the NEXT reconnect's "init" then pushes the server's still-OLD
// value back out — clobbering the click with no indication it never
// actually took effect. Flushed the moment the socket reopens.
let pendingRenamingSend  = null;

// True from the moment a pending send is flushed until its echo comes
// back (or a safety timeout fires). The server's "init" on reconnect
// is sent the instant it accepts the connection — using its OLD
// value, before it's seen our flushed message — and is guaranteed to
// arrive before that message's own "renaming" echo does. Without this
// guard, applying init's stale value would flash the button to the
// wrong label for one round trip before self-correcting.
let awaitingRenamingEcho = false;

// Which background-tab batch job (if any) currently owns chrome.tabs.create
// against real Tradetech records — AWR Audit and Rotation Receipt Capture
// both walk records one at a time in hidden tabs; nothing before this
// stopped them from running concurrently against the same records.
let batchJobRunning = null; // "awr" | "receipt-capture" | null

importScripts("utils/relay-socket-client.js");

console.log("🛰 Background script loaded");

// ── WebSocket Connection ─────────────────────────────────────
function connectWebSocket() {
    connectRelaySocket({
        onSocket: (socket) => { ws = socket; },
        onOpen: () => {
        setRelayAvailable(true);

        // Deliver whatever click(s) couldn't reach the server while we
        // were disconnected, before the server's own "init" (which
        // arrives right after this on the same connection) has a
        // chance to overwrite it with a stale value.
        if (pendingRenamingSend !== null) {
            ws.send(JSON.stringify({ type: "renaming", enabled: pendingRenamingSend }));
            console.log("📤 Flushed pending renaming state after reconnect:", pendingRenamingSend);
            pendingRenamingSend  = null;
            awaitingRenamingEcho = true;
            // Safety net: if the echo never comes back (e.g. disconnects
            // again right away), don't get stuck ignoring every future
            // "init" forever — give up waiting after 5s and go back to
            // trusting the server normally.
            setTimeout(() => { awaitingRenamingEcho = false; }, 5000);
        }
        },

        onMessage: (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "init") {
                console.log("📥 Init state received:", data.serviceCode || "", data.renamingEnabled);

                // Skip applying init's renamingEnabled if we just flushed
                // a pending click and are waiting for ITS echo instead —
                // init's value is guaranteed to be stale in that case
                // (see awaitingRenamingEcho above).
                if (!awaitingRenamingEcho) {
                    renamingEnabled = data.renamingEnabled !== false;
                    chrome.storage.local.set({ renamingEnabled });

                    // This fires on every (re)connect — server restart, the
                    // service worker waking from suspend, a network blip —
                    // not just the very first connect. Any tab whose button
                    // was already open before that reconnect has a LOCAL
                    // `enabled` that can now be stale against the server's
                    // authoritative value (e.g. relay-state.js resets to its
                    // hardcoded default on every server restart). Without
                    // this broadcast, that tab's button silently drifts out
                    // of sync with what the server will actually enforce.
                    broadcastRenameState();
                }
            }

            if (data.type === "service") {
                console.log("📥 Service code updated:", data.code || "");
            }

            if (data.type === "renaming") {
                renamingEnabled = data.enabled;
                chrome.storage.local.set({ renamingEnabled });
                awaitingRenamingEcho = false;
                console.log("🔄 Renaming enabled:", renamingEnabled);
                broadcastRenameState();
            }

        } catch (err) {
            console.error("❌ Bad message:", err);
        }
        },

        onClose: () => setRelayAvailable(false)
    });
}

connectWebSocket();

// ── Message relay for content scripts that can't open their own
// WebSocket ────────────────────────────────────────────────────
// rename-toggle-relay.js runs on <all_urls> (except Tradetech), and some
// sites (e.g. Maersk) set a Content-Security-Policy connect-src that
// doesn't include ws://localhost:3737 — the browser blocks that
// connection before it even leaves the machine, no matter how well
// the relay server is running, because the connection is being
// opened from INSIDE the page's own context, which the page's own
// CSP governs. This service worker is NOT part of any page and isn't
// bound by any page's CSP, so content scripts ask IT for the current
// state (and tell IT about changes) via chrome.runtime.sendMessage
// instead of opening a direct socket of their own.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_RENAME_STATE") {
        // Read from storage (survives service-worker restarts) instead
        // of trusting renamingEnabled, which resets to its hardcoded
        // default every time the worker wakes back up from being
        // suspended, before the WebSocket reconnects and corrects it.
        chrome.storage.local.get("renamingEnabled", (data) => {
            sendResponse({ enabled: data.renamingEnabled ?? renamingEnabled, relayAvailable });
        });
        return true; // async sendResponse — keep the channel open
    }

    // schedule-table-scrape-relay.js runs on yangming.com, whose CSP blocks a
    // direct WebSocket to localhost:3737 the same way Maersk's does (see
    // the comment above this listener) -- it asks this service worker to
    // relay the scraped data instead, since this context isn't bound by
    // any page's CSP.
    if (message?.type === "DOM_SCRAPE") {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "dom-scrape", ...message.payload }));
            sendResponse({ ok: true });
        } else {
            sendResponse({ ok: false, error: "requires local relay server" });
        }
        return;
    }

    if (message?.type === "RUN_AWR_AUDIT") {
        if (batchJobRunning) {
            sendResponse({ ok: false, started: false, reason: "busy", runningJob: batchJobRunning });
            return;
        }
        batchJobRunning = "awr";
        runAwrAudit().finally(() => { batchJobRunning = null; });
        sendResponse({ ok: true, started: true });
        return;
    }

    if (message?.type === "RUN_ROTATION_RECEIPT_CAPTURE") {
        if (batchJobRunning) {
            sendResponse({ ok: false, started: false, reason: "busy", runningJob: batchJobRunning });
            return;
        }
        batchJobRunning = "receipt-capture";
        runRotationReceiptCapture(message.records || null).finally(() => { batchJobRunning = null; });
        sendResponse({ ok: true, started: true });
        return;
    }

    if (message?.type === "SET_RENAME_STATE") {
        renamingEnabled = message.enabled;
        chrome.storage.local.set({ renamingEnabled });
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "renaming", enabled: renamingEnabled }));
        } else {
            // Socket isn't open right now (reconnecting) — remember this
            // so connectWebSocket()'s "open" handler sends it the moment
            // the connection comes back, instead of the click just
            // vanishing with the server never finding out.
            pendingRenamingSend = renamingEnabled;
        }
        broadcastRenameState();
        return;
    }
});

// Pushes the current renaming state out to every open tab's content
// script, so every rename-toggle-relay.js instance (one per open tab) stays
// in sync whether the change came from another tab's button click or
// from the relay server's own "renaming" broadcast (e.g. someone
// toggled it from a different browser entirely).
function broadcastRenameState() {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(
                tab.id,
                { type: "RENAME_STATE_CHANGED", enabled: renamingEnabled },
                () => {
                    // Tabs with no content script (chrome://, other
                    // extensions' pages, etc.) throw "Receiving end
                    // does not exist" — expected and safe to ignore.
                    void chrome.runtime.lastError;
                }
            );
        }
    });
}

// Renaming is handled server-side by download-watcher.js (chokidar
// watching the Downloads folder) — no onDeterminingFilename listener
// needed here. One used to exist as a pure pass-through, but for a
// data: URL download (e.g. Full Page Capture's) Chrome's own filename
// guess passed into that listener isn't reliably the explicit filename
// requested via chrome.downloads.download({filename}) — echoing it back
// could silently clobber that explicit name with a generic one.


// Recognized schedule pages whose real HTML the relay can parse directly
// (see service-relay/proof-parsers/yangming-html.js) -- far more reliable
// than OCR-ing the screenshot, since it's the operator's own exact text,
// not pixels. Piggybacks on the SAME toolbar-icon click already used for
// the whole-page screenshot, so capturing a schedule page needs no extra
// action: one click saves both the screenshot AND this HTML file. The
// relay's download-watcher.js picks it up from the Downloads folder the
// same way it already does for the PNG -- no separate manual "Save Page
// As" step, and no content-script/CSP involvement at all (a plain
// chrome.downloads.download() call from this service-worker, not a
// network request from inside the page).
function isRecognizedSchedulePage(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === "www.yangming.com" &&
            parsed.pathname === "/en/esolution/long_term_schedule_detail";
    } catch {
        return false;
    }
}

async function maybeCaptureSchedulePageHtml(tab) {
    const recognized = isRecognizedSchedulePage(tab.url);
    console.log(`🔍 maybeCaptureSchedulePageHtml: tab.url=${tab.url} recognized=${recognized}`);
    if (!recognized) return;
    try {
        const [{ result: html }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML,
        });
        if (!html) return;
        // Chrome's download handling can quietly refuse a data: URL
        // declared as text/html (Safe-Browsing-style ambiguity between
        // "downloadable file" and "page to render") -- a generic type
        // downloads the exact same bytes without that risk. Only the
        // filename's .html extension matters to download-watcher.js on
        // disk, not this URL's declared MIME type.
        const dataUrl = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(html)}`;
        await chrome.downloads.download({
            url: dataUrl,
            filename: `schedule-page-${Date.now()}.html`,
        });
        console.log("📄 Schedule page HTML captured alongside the screenshot");
    } catch (err) {
        // Best-effort -- never let this break the screenshot capture itself.
        console.error("[ScheduleHtmlCapture]", err);
    }
}


// ── AWR Audit ─────────────────────────────────────────────────
// Walks every record the relay already knows about (from due-service-
// scanner-relay.js's own posted scans — no fresh Tradetech search
// triggered here), opening each one's edit page in an inactive
// background tab. Deliberately reuses the SAME content script
// (awr-flag.js) that runs during normal interactive editing, rather
// than duplicating its qualifies-logic here — that script writes its
// verdict into a data-attribute (see AwrFlag.reportAuditResult) that
// this reads back out once the page has settled. awr-flag.js itself
// only SUGGESTS now (a real compliance call needs a human looking at
// it during normal interactive editing) — it never auto-applies, so
// unlike before, this audit is what actually clicks the correct radio
// for a disagreeing record; there's no human here to click Apply.
// Only records whose AWR value actually needed correcting get Saved;
// everything else is just closed. Sequential and throttled on
// purpose — this is real production data, not a resource to hammer.
const AWR_AUDIT_SETTLE_MS = 1500;
const AWR_AUDIT_THROTTLE_MS = 800;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId) {
    return new Promise((resolve) => {
        function listener(id, info) {
            if (id === tabId && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        }
        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function auditOneRecord(record, expectedNextUpdateDate, windowId) {
    // ttBatchJob=1 tells service-relay-send-relay.js (and anything else
    // that shouldn't run on a batch tab) that this isn't the user's own
    // page — see that file's isBatchTab() for why.
    const url = `https://www.tradetech.net/cgi/inframe/cgi/u/schedule_detailsB.pl?record=${record}&mode=E&ttBatchJob=1`;
    const tab = await chrome.tabs.create({ url, active: false, windowId });

    try {
        await waitForTabComplete(tab.id);
        await sleep(AWR_AUDIT_SETTLE_MS); // let content scripts finish (AwrFlag's own self-correction included)

        // allFrames: true — schedule_detailsB.pl?...&mode=E is itself a
        // frameset (matches its own /inframe/ URL, and the Save button's
        // parent.fr1.doSave() calling a SIBLING frame confirms it): the
        // actual edit form with the allWater radios lives in a CHILD
        // frame, not the top document. Without allFrames, this only ever
        // reads the (empty) top frame and silently finds nothing.
        const auditFrames = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => {
                const raw = document.documentElement.dataset.ttAwrAudit;
                return raw ? JSON.parse(raw) : null;
            }
        });
        const audit = auditFrames.map(f => f.result).find(r => r) || null;

        if (!audit) {
            return { record, skipped: true, reason: "no allWater radios found on this record's page" };
        }

        const needsCorrection = audit.qualifies !== audit.checked;
        if (!needsCorrection) {
            return { record, corrected: false, qualifies: audit.qualifies, checked: audit.checked };
        }

        // Needs correcting — awr-flag.js only reported the disagreement
        // (it suggests, it doesn't apply itself), so the audit applies it:
        // a real click on the radio that matches `qualifies`, same event
        // Tradetech itself expects (mirrors AwrFlag's own suggestion-apply
        // click, just triggered here instead of by a human).
        const clickFrames = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            args: [audit.qualifies],
            func: (shouldBeYes) => {
                const radio = document.querySelector(`input[name="allWater"][value="${shouldBeYes ? "Yes" : "No"}"]`);
                if (!radio) return null;
                radio.click();
                return { ok: true };
            }
        });
        const clickResult = clickFrames.map(f => f.result).find(r => r);
        if (!clickResult) {
            return { record, corrected: false, qualifies: audit.qualifies, checked: audit.checked,
                error: "allWater radio not found to apply the correction" };
        }

        // Tradetech's own page touches next_update_date just from opening
        // the record for edit, independent of anything we do — so before
        // saving, force it back to the value the relay already had on
        // record for this service (captured by due-service-scanner-relay.js
        // BEFORE this record was ever opened this session), overriding
        // whatever Tradetech set it to on open. expectedNextUpdateDate
        // comes in as the relay's DD-MMM-YYYY scrape format and MUST be
        // converted to the field's own MM/DD/YY before writing — writing
        // the raw relay format directly is exactly what blanked a live
        // record's date earlier (Tradetech's dateformat() couldn't parse
        // it and cleared the field, which then got saved). The verify
        // step below refuses to save at all unless the field genuinely
        // holds a real-looking date after formatting.
        let dateRestore = { skipped: true };
        const formattedDate = expectedNextUpdateDate ? ddMmmYyyyToMmDdYy(expectedNextUpdateDate) : null;

        if (expectedNextUpdateDate && !formattedDate) {
            return { record, corrected: true, qualifies: audit.qualifies, savedOk: false,
                saveError: `could not parse relay date "${expectedNextUpdateDate}" — refused to touch next_update_date or save` };
        }

        if (formattedDate) {
            const dateFrames = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                args: [formattedDate],
                func: (expected) => {
                    const field = document.querySelector('input[name="next_update_date"]');
                    if (!field) return null;
                    if (field.value.trim() === expected.trim()) return { ok: true, changed: false };
                    const before = field.value;
                    field.value = expected;
                    field.dispatchEvent(new Event("change", { bubbles: true }));
                    return { ok: true, changed: true, before, after: field.value };
                }
            });
            dateRestore = dateFrames.map(f => f.result).find(r => r) ||
                { ok: false, error: "next_update_date field not found in any frame" };

            await sleep(500); // let dateformat()'s own reformatting settle before verifying

            const verifyFrames = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => {
                    const field = document.querySelector('input[name="next_update_date"]');
                    return field ? field.value : null;
                }
            });
            const currentValue = verifyFrames.map(f => f.result).find(r => r != null);

            if (dateRestore.ok && dateRestore.changed && !/^\d{2}\/\d{2}\/\d{2}$/.test(currentValue || "")) {
                return { record, corrected: true, qualifies: audit.qualifies, dateRestore, savedOk: false,
                    saveError: `next_update_date ended up as "${currentValue}" after formatting — refused to save` };
            }
        }

        let saveOk = false, saveError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            const saveFrames = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => {
                    const btn = document.querySelector('input[type="button"][value="Save"]');
                    if (!btn) return null;
                    try { btn.click(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
                }
            });
            const clickResult = saveFrames.map(f => f.result).find(r => r);
            if (!clickResult) { saveError = "Save button not found in any frame"; break; }
            if (!clickResult.ok) { saveError = clickResult.error; continue; }

            await sleep(AWR_AUDIT_SETTLE_MS);

            const errorFrames = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => /error/i.test(document.body?.innerText || "")
            });
            if (!errorFrames.some(f => f.result)) { saveOk = true; break; }
            saveError = "possible error text detected on page after save";
        }
        const saveResult = { ok: saveOk, error: saveOk ? undefined : saveError };

        if (saveResult.ok) {
            await sleep(AWR_AUDIT_SETTLE_MS); // let the save round-trip finish before the tab closes
        }

        return {
            record,
            corrected: true,
            qualifies: audit.qualifies,
            dateRestore,
            savedOk: saveResult.ok,
            saveError: saveResult.error
        };
    } finally {
        await chrome.tabs.remove(tab.id).catch(() => {});
    }
}

async function runAwrAudit() {
    console.log("🔍 AWR audit: fetching relay-tracked records…");
    let services;
    try {
        const res = await fetch("http://localhost:3737/due-services");
        ({ services } = await res.json());
    } catch (err) {
        console.error("❌ AWR audit: could not reach relay for the record list:", err);
        return;
    }

    // Map, not just a Set of ids -- each record's LAST-KNOWN
    // next_update_date (from the relay's own prior scan, before this
    // record is ever opened this session) is what auditOneRecord()
    // restores the field to before saving, since Tradetech's own page
    // touches that field just from opening the record for edit.
    const recordDates = new Map();
    for (const s of services) {
        if (s.record) recordDates.set(s.record, s.nextUpdateDate);
    }
    const records = [...recordDates.keys()];
    console.log(`🔍 AWR audit: ${records.length} record(s) to check, one at a time`);

    // Every background tab this batch opens lives in ONE dedicated window,
    // created fresh here — never whatever window happens to be focused, so
    // it can't "follow the mouse" if the user switches windows mid-run.
    const batchWindow = await chrome.windows.create({ focused: false, url: "about:blank" });
    const windowId = batchWindow.id;

    const results = [];
    try {
        for (const [i, record] of records.entries()) {
            console.log(`🔍 [${i + 1}/${records.length}] checking record ${record}…`);
            try {
                const result = await auditOneRecord(record, recordDates.get(record), windowId);
                results.push(result);
                console.log(`🔍 [${i + 1}/${records.length}] record ${record}:`, result);
            } catch (err) {
                console.error(`❌ AWR audit: record ${record} failed:`, err);
                results.push({ record, error: err.message });
            }
            await sleep(AWR_AUDIT_THROTTLE_MS);
        }
    } finally {
        await chrome.windows.remove(windowId).catch(() => {});
    }

    const corrected = results.filter(r => r.corrected);
    const failed    = results.filter(r => r.corrected && !r.savedOk);
    console.log(
        `✅ AWR audit complete — ${results.length} checked, ${corrected.length} corrected` +
        (failed.length ? `, ⚠️ ${failed.length} save failure(s) — see above` : "")
    );
    console.log("🔍 Full AWR audit report:", results);
}

// ── Rotation Receipt Capture ─────────────────────────────────
// Same background-tab shape as AWR Audit, but purely read-only: visits
// a record, asks the page's own SaveConfirmation.captureForBatchAudit()
// (via chrome.scripting.executeScript, same allFrames pattern AWR Audit
// uses to reach whichever frame actually has the form) to download that
// record's Rotation Receipt PNG, then closes the tab. Never clicks
// anything, never writes a field, never saves — visit, capture, close.
const RECEIPT_CAPTURE_SETTLE_MS   = 1500;
const RECEIPT_CAPTURE_THROTTLE_MS = 800;

// POST JSON to the local relay server from this service worker (exempt
// from any page's CORS — content scripts can't do this without an
// allowlisted origin).
async function postToRelay(path, body) {
    try {
        const res = await fetch(`http://localhost:3737${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (res.ok) return { ok: true };
        const data = await res.json().catch(() => ({}));
        return { ok: false, error: `(${res.status}) ${data.error || res.statusText}` };
    } catch (err) {
        return { ok: false, error: `could not reach relay: ${err.message}` };
    }
}

async function captureOneReceipt(record, windowId) {
    const url = `https://www.tradetech.net/cgi/inframe/cgi/u/schedule_detailsB.pl?record=${record}&mode=E&ttBatchJob=1`;
    const tab = await chrome.tabs.create({ url, active: false, windowId });

    try {
        await waitForTabComplete(tab.id);
        await sleep(RECEIPT_CAPTURE_SETTLE_MS); // let PortHighlighting/SaveConfirmation's own init() finish

        // RotationReceiptCapture.captureForBatch() (rotation-receipt-
        // capture-relay.js) returns null from every frame without the
        // port rows, and a real object only from the one that has them —
        // so a plain first-truthy dedup is safe here. (Returning
        // {ok:false,...} objects from non-matching frames was a real
        // bug: the first frame's failure always won the dedup.)
        const frames = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => (typeof RotationReceiptCapture === "undefined" ? null : RotationReceiptCapture.captureForBatch())
        });
        const result = frames.map(f => f.result).find(Boolean) || null;

        if (!result) {
            return { record, captured: false, reviewed: false, reason: "no port rows found in any frame" };
        }

        // Review data for EVERY record (not just special ones) — the
        // dashboard's Highlight Review page needs the ones where the
        // logic found nothing too, to catch misses, not just wrong picks.
        let reviewed = false, reviewError = null;
        if (result.review?.ports?.length) {
            const saved = await postToRelay("/highlight-review/submit", { record: String(record), ...result.review });
            reviewed = saved.ok;
            reviewError = saved.error || null;
        }

        // Receipt PNG — every record; one with no special port shows the
        // SP001 fallback row highlighted.
        const png = result.png;
        if (!png?.ok) {
            return { record, captured: false, reviewed, reviewError, reason: png?.reason || "no receipt image produced" };
        }

        // POSTs straight to the local relay server, which writes the PNG
        // to disk itself (routes/receipts.js) — not Chrome's downloads
        // API. Two real problems that ruled it out: (1) many
        // chrome.downloads.download() calls fired back-to-back from
        // background tabs were still landing in the visible download
        // shelf/history, which isn't wanted for records visited
        // automatically rather than by hand; (2) before that, a plain
        // content-script <a>.click() per record hit Chrome's automatic-
        // download-blocking guard and silently dropped some receipts
        // partway through a run. A server-side file write has neither
        // failure mode.
        const receipt = await postToRelay("/save-receipt", { filename: png.filename, dataUrl: png.dataUrl });
        if (!receipt.ok) {
            return { record, captured: false, reviewed, reviewError, reason: `relay save failed ${receipt.error}` };
        }

        return { record, captured: true, reviewed, reviewError };
    } finally {
        await chrome.tabs.remove(tab.id).catch(() => {});
    }
}

// `records`, when given, is an explicit list of record IDs (e.g. read
// from a user-picked CSV) — skips the due-services fetch entirely and
// runs over exactly those records instead.
async function runRotationReceiptCapture(records) {
    let targetRecords = records;

    if (!targetRecords || targetRecords.length === 0) {
        console.log("🧾 Receipt capture: fetching relay-tracked records…");
        try {
            const res = await fetch("http://localhost:3737/due-services");
            const { services } = await res.json();
            targetRecords = [...new Set(services.map(s => s.record).filter(Boolean))];
        } catch (err) {
            console.error("❌ Receipt capture: could not reach relay for the record list:", err);
            return;
        }
    }

    console.log(`🧾 Receipt capture: ${targetRecords.length} record(s), one at a time`);

    const batchWindow = await chrome.windows.create({ focused: false, url: "about:blank" });
    const windowId = batchWindow.id;

    const results = [];
    try {
        for (const [i, record] of targetRecords.entries()) {
            console.log(`🧾 [${i + 1}/${targetRecords.length}] capturing record ${record}…`);
            try {
                const result = await captureOneReceipt(record, windowId);
                results.push(result);
                console.log(`🧾 [${i + 1}/${targetRecords.length}] record ${record}:`, result);
            } catch (err) {
                console.error(`❌ Receipt capture: record ${record} failed:`, err);
                results.push({ record, captured: false, error: err.message });
            }
            await sleep(RECEIPT_CAPTURE_THROTTLE_MS);
        }
    } finally {
        await chrome.windows.remove(windowId).catch(() => {});
    }

    const captured = results.filter(r => r.captured).length;
    const reviewed = results.filter(r => r.reviewed).length;
    console.log(
        `✅ Receipt capture complete — ${results.length} visited, ${reviewed} saved for Highlight Review ` +
        `(http://localhost:3737/dashboard/highlight-review), ${captured} receipt image(s) saved`
    );
    console.log("🧾 Full receipt capture report:", results);
}

// ── One-off: restore next_update_date on records the AWR audit's
// format bug blanked ─────────────────────────────────────────
// auditOneRecord() force-wrote the relay's cached DD-MMM-YYYY date
// string directly into a field that expects MM/DD/YY, with no format
// conversion -- Tradetech's own dateformat() handler couldn't parse
// it and blanked the field instead, which then got Saved. This
// converts properly, VERIFIES the field actually holds a real date
// after formatting (never saves on a blank/malformed result), and
// retries the Save click once if an error is detected afterward.
// Snapshot values below, not a fresh relay fetch -- these are the
// confirmed pre-corruption originals as of the incident; a live
// re-fetch now could pick up already-corrupted data instead.
const AWR_DATE_RESTORE_RECORDS = {
    "19980": "09-SEP-2026", "16371": "17-SEP-2026", "17794": "18-SEP-2026",
    "17700": "18-SEP-2026", "19900": "08-SEP-2026", "20460": "19-SEP-2026",
    "19552": "10-SEP-2026", "19934": "18-SEP-2026", "19192": "18-SEP-2026",
    "17907": "11-SEP-2026", "19104": "18-SEP-2026", "19424": "10-SEP-2026",
    "17963": "16-SEP-2026", "17946": "12-SEP-2026", "19364": "11-SEP-2026",
    "15457": "08-SEP-2026", "19435": "17-SEP-2026", "19434": "08-SEP-2026",
    "20576": "10-SEP-2026", "20026": "11-SEP-2026"
};

function ddMmmYyyyToMmDdYy(raw) {
    const MONTHS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
    const m = raw.trim().toUpperCase().match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
    if (!m) return null;
    const [, day, mon, year] = m;
    const monthNum = MONTHS[mon];
    if (!monthNum) return null;
    return `${String(monthNum).padStart(2, "0")}/${day.padStart(2, "0")}/${year.slice(-2)}`;
}

async function restoreOneNextUpdateDate(record, rawExpected) {
    const formatted = ddMmmYyyyToMmDdYy(rawExpected);
    if (!formatted) return { record, ok: false, error: `could not parse date "${rawExpected}"` };

    const url = `https://www.tradetech.net/cgi/inframe/cgi/u/schedule_detailsB.pl?record=${record}&mode=E`;
    const tab = await chrome.tabs.create({ url, active: false });

    try {
        await waitForTabComplete(tab.id);
        await sleep(AWR_AUDIT_SETTLE_MS);

        const setFrames = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            args: [formatted],
            func: (value) => {
                const field = document.querySelector('input[name="next_update_date"]');
                if (!field) return null;
                field.value = value;
                field.dispatchEvent(new Event("change", { bubbles: true }));
                return { fieldFound: true };
            }
        });
        if (!setFrames.some(f => f.result)) {
            return { record, ok: false, error: "next_update_date field not found in any frame" };
        }

        await sleep(500); // let dateformat()'s own reformatting settle

        const verifyFrames = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => {
                const field = document.querySelector('input[name="next_update_date"]');
                return field ? field.value : null;
            }
        });
        const currentValue = verifyFrames.map(f => f.result).find(r => r != null);

        // Refuse to save unless the field genuinely holds a real-looking
        // date after formatting -- this exact check is what last time's
        // bug skipped, and it's what actually blanked a live record.
        if (!currentValue || !/^\d{2}\/\d{2}\/\d{2}$/.test(currentValue)) {
            return {
                record, ok: false,
                error: `field ended up as "${currentValue}" after formatting -- refused to save`,
                attempted: formatted
            };
        }

        let saveOk = false, saveError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            const saveFrames = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => {
                    const btn = document.querySelector('input[type="button"][value="Save"]');
                    if (!btn) return null;
                    try { btn.click(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
                }
            });
            const clickResult = saveFrames.map(f => f.result).find(r => r);
            if (!clickResult) { saveError = "Save button not found in any frame"; break; }
            if (!clickResult.ok) { saveError = clickResult.error; continue; }

            await sleep(AWR_AUDIT_SETTLE_MS);

            // Best-effort generic error check -- refine once the actual
            // error UI shape is confirmed; for now just looks for the
            // word "error" anywhere visible on the page after saving.
            const errorFrames = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => /error/i.test(document.body?.innerText || "")
            });
            const errorSeen = errorFrames.some(f => f.result);

            if (!errorSeen) { saveOk = true; break; }
            saveError = "possible error text detected on page after save";
        }

        return {
            record, ok: saveOk,
            restoredTo: formatted, verifiedFieldValue: currentValue,
            saveError: saveOk ? undefined : saveError
        };
    } finally {
        await chrome.tabs.remove(tab.id).catch(() => {});
    }
}

// Call from this service worker's own console after reloading the
// extension: restoreNextUpdateDates()
async function restoreNextUpdateDates() {
    const entries = Object.entries(AWR_DATE_RESTORE_RECORDS);
    console.log(`🩹 Restoring next_update_date for ${entries.length} record(s), one at a time`);

    const results = [];
    for (const [i, [record, rawDate]] of entries.entries()) {
        console.log(`🩹 [${i + 1}/${entries.length}] restoring record ${record} → ${rawDate}…`);
        try {
            const result = await restoreOneNextUpdateDate(record, rawDate);
            results.push(result);
            console.log(`🩹 [${i + 1}/${entries.length}] record ${record}:`, result);
        } catch (err) {
            console.error(`❌ restore failed for record ${record}:`, err);
            results.push({ record, ok: false, error: err.message });
        }
        await sleep(AWR_AUDIT_THROTTLE_MS);
    }

    const failed = results.filter(r => !r.ok);
    console.log(
        `✅ Restore complete — ${results.length - failed.length}/${results.length} succeeded` +
        (failed.length ? `, ⚠️ ${failed.length} FAILED — needs manual fix, see below` : "")
    );
    console.log("🩹 Full restore report:", results);
    if (failed.length) console.warn("⚠️ Failed records — fix these manually:", failed);
}

function setRelayAvailable(available) {
    if (relayAvailable === available) return;
    relayAvailable = available;
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(
                tab.id,
                { type: "RELAY_STATUS_CHANGED", available },
                () => { void chrome.runtime.lastError; }
            );
        }
    });
}

// importScripts executes before the base resumes; preserve this registry there.
(globalThis.fpcExtraCaptures ||= []).push(tab => maybeCaptureSchedulePageHtml(tab));
