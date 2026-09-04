// ============================================================
//  background.js (community edition)
//  The full extension's background.js also connects to the
//  relay server for rename-state sync and Yang Ming DOM-scrape
//  relaying — this build has no relay server at all, so that
//  entire section (and rename-toggle.js, its only real caller)
//  is omitted rather than shipped as dead code. Full Page
//  Capture is unrelated to the relay and works identically here.
// ============================================================

console.log("🛰 Background script loaded (community edition)");

// ── Full Page Capture ────────────────────────────────────────
// GoFullPage replacement. Triggered by the toolbar icon (an activeTab
// gesture), NOT a popup — manifest.json's "action" has no default_popup,
// so this fires directly on click. Only the service worker can call
// captureVisibleTab(), but it has no DOM/canvas access in MV3, so the
// actual stitching happens in an on-demand-injected content script
// (full-page-capture-inject.js) — never added to a static content_scripts
// block, since this must work on whatever site the user happens to be on.
// The finished PNG is saved via a plain chrome.downloads.download() with
// a throwaway filename.

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

async function runFullPageCapture(tab) {
    if (fpcInProgress) return;
    fpcInProgress = true;
    try {
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
        // headers, floating toolbars) before scrolling, so it doesn't get
        // captured once per slice. visibility:hidden (not display:none)
        // keeps layout/height stable rather than reflowing the page
        // mid-capture. Always restored in the finally block below, even
        // on error.
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
