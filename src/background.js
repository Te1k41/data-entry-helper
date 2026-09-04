// ============================================================
//  background.js
//  Connects to relay via WebSocket for real-time state sync.
// ============================================================

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
// rename-toggle.js runs on <all_urls> (except Tradetech), and some
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
    // window.close() from a content script only works if the tab has a
    // live window.opener reference (opened via a script/target="_blank"
    // link) — Tradetech's own Preview link doesn't reliably preserve
    // that, so schedule-preview-tools.js's Mark Done button asks the
    // background script to close its tab instead. chrome.tabs.remove()
    // is a privileged extension API, not page-script window.close(), so
    // it isn't subject to that same-opener restriction at all.
    if (message?.type === "CLOSE_TAB") {
        if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
        return;
    }

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

    // schedule-table-scrape.js runs on yangming.com, whose CSP blocks a
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
// script, so every rename-toggle.js instance (one per open tab) stays
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

// ── Full Page Capture ────────────────────────────────────────
// GoFullPage replacement. Triggered by the toolbar icon (an activeTab
// gesture), NOT a popup — manifest.json's "action" has no default_popup,
// so this fires directly on click. Only the service worker can call
// captureVisibleTab(), but it has no DOM/canvas access in MV3, so the
// actual stitching happens in an on-demand-injected content script
// (full-page-capture-inject.js) — never added to a static content_scripts
// block, since this must work on whatever site the user happens to be on.
// The finished PNG is saved via a plain chrome.downloads.download() with
// a throwaway filename — the relay server's download-watcher.js already
// renames ANY new matching file per the existing Rename-toggle pipeline,
// so no relay-side change or custom rename step is needed here.

const FPC_MAX_DIMENSION  = 32767;      // same Firefox/Chrome canvas ceiling as service-relay/dashboard/merge.js
const FPC_MAX_AREA       = 268435456;
const FPC_SLICE_DELAY_MS = 600;        // ponytail: one knob covers both scroll-repaint settle AND the
                                        // ~2 calls/sec captureVisibleTab rate limit — bump this first if
                                        // MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND errors ever show up

let fpcInProgress = false; // ponytail: global lock, not per-tab — one capture per profile at a time
                            // is the only realistic case here; per-tab lock is the upgrade path

chrome.action.onClicked.addListener((tab) => {
    runFullPageCapture(tab).catch((err) => {
        console.error("[FullPageCapture]", err);
        reportCaptureError(tab.id, err.message);
    });
});

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

async function runFullPageCapture(tab) {
    if (fpcInProgress) return;
    fpcInProgress = true;
    try {
        // Independent of the screenshot flow below -- runs alongside it,
        // not blocking on its multi-second scroll-and-stitch process.
        maybeCaptureSchedulePageHtml(tab);

        const [{ result: metrics }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({
                totalHeight:    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                viewportWidth:  window.innerWidth,
                viewportHeight: window.innerHeight,
                dpr:            window.devicePixelRatio || 1,
                originalX:      window.scrollX,
                originalY:      window.scrollY,
            })
        });

        // captureVisibleTab returns device-pixel images (CSS px * dpr) —
        // the stitched canvas must be sized/positioned in that space too.
        const canvasWidth  = Math.round(metrics.viewportWidth * metrics.dpr);
        const canvasHeight = Math.round(metrics.totalHeight   * metrics.dpr);

        if (canvasWidth > FPC_MAX_DIMENSION || canvasHeight > FPC_MAX_DIMENSION) {
            throw new Error(`Page is too large to capture (${canvasWidth}×${canvasHeight}px exceeds the ${FPC_MAX_DIMENSION}px canvas limit).`);
        }
        if (canvasWidth * canvasHeight > FPC_MAX_AREA) {
            throw new Error(`Page is too large to capture (${canvasWidth}×${canvasHeight}px exceeds the browser's canvas area limit).`);
        }

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["src/features/full-page-capture-inject.js"]
        });

        const startResp = await sendToTab(tab.id, { type: "FPC_START", canvasWidth, canvasHeight });
        if (!startResp?.ok) throw new Error(startResp?.error || "Could not start capture canvas");

        // GoFullPage-style: hide every position:fixed/sticky element (sticky
        // headers, floating toolbars — including our own rename-toggle
        // button) before scrolling, so it doesn't get captured once per
        // slice. visibility:hidden (not display:none) keeps layout/height
        // stable rather than reflowing the page mid-capture. Always
        // restored in the finally block below, even on error.
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                document.querySelectorAll("*").forEach((el) => {
                    const cs = getComputedStyle(el);
                    if (cs.position === "fixed" || cs.position === "sticky") {
                        el.dataset.ttFpcPrevVisibility = el.style.visibility || "";
                        el.style.visibility = "hidden";
                    }
                });
            }
        });

        try {
            const slices = Math.max(1, Math.ceil(metrics.totalHeight / metrics.viewportHeight));
            for (let i = 0; i < slices; i++) {
                const scrollY = Math.min(i * metrics.viewportHeight, metrics.totalHeight - metrics.viewportHeight);

                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (y) => window.scrollTo(0, y),
                    args: [scrollY]
                });

                // ponytail: fixed delay, no scroll-completion/lazy-image-load
                // detection. Upgrade path if a real page proves flaky: double
                // rAF or a short MutationObserver-based debounce before capture.
                await sleep(FPC_SLICE_DELAY_MS);

                const dataUrl = await captureWithRetry(tab.windowId);

                const sliceResp = await sendToTab(tab.id, {
                    type: "FPC_SLICE",
                    dataUrl,
                    y: Math.round(scrollY * metrics.dpr)
                });
                if (!sliceResp?.ok) throw new Error(sliceResp?.error || `Could not draw slice ${i + 1}/${slices}`);
            }
        } finally {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    document.querySelectorAll("[data-tt-fpc-prev-visibility]").forEach((el) => {
                        el.style.visibility = el.dataset.ttFpcPrevVisibility;
                        delete el.dataset.ttFpcPrevVisibility;
                    });
                }
            }).catch(() => {}); // tab may have navigated/closed mid-capture — best effort only
        }

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (x, y) => window.scrollTo(x, y),
            args: [metrics.originalX, metrics.originalY]
        });

        const finishResp = await sendToTab(tab.id, { type: "FPC_FINISH" });
        if (!finishResp?.ok) throw new Error(finishResp?.error || "Stitching failed");

        // Fixed "fullcapture-" name, independent of the current service
        // code / Rename toggle — chrome.downloads.download's filename is
        // set directly here regardless of Rename state, so this is always
        // a clear, recognizable name whether Rename is on or off. Not
        // meant to be renamed to {service}-{date} like a normal proof
        // screenshot — service-relay/merge-cleanup.js's STEP 1 recognizes
        // this same "fullcapture-" prefix and deletes today's leftover
        // raw captures once a dashboard merge finishes downloading.
        await chrome.downloads.download({
            url: finishResp.dataUrl,
            filename: `fullcapture-${Date.now()}.png`
        });
    } finally {
        fpcInProgress = false;
    }
}

function sendToTab(tabId, message) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            resolve(response);
        });
    });
}

async function captureWithRetry(windowId) {
    try {
        return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    } catch (err) {
        // Most likely MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND — back off once and retry.
        await sleep(1000);
        return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// No chrome.notifications permission/icon added for this — simplest option
// that needs no new permission and is unmissable in the same tab the user
// just tried to capture.
function reportCaptureError(tabId, message) {
    chrome.scripting.executeScript({
        target: { tabId },
        func: (msg) => alert("Full Page Capture failed: " + msg),
        args: [message]
    }).catch(() => {}); // tab may have navigated/closed mid-capture — best effort only
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
