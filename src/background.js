// ============================================================
// Full Page Capture always runs. Rename-state sync, DOM-scrape
// relaying, and schedule HTML side-capture live in the relay companion.
// ============================================================
importScripts("background-relay.js");

// The imported companion may already have registered a side-capture.
var fpcExtraCaptures = globalThis.fpcExtraCaptures || [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // window.close() from a content script only works if the tab has a
    // live window.opener reference (opened via a script/target="_blank"
    // link) — Tradetech's own Preview link doesn't reliably preserve
    // that, so schedule-preview-tools-relay.js's Mark Done button asks the
    // background script to close its tab instead. chrome.tabs.remove()
    // is a privileged extension API, not page-script window.close(), so
    // it isn't subject to that same-opener restriction at all.
    if (message?.type === "CLOSE_TAB") {
        if (sender.tab?.id) chrome.tabs.remove(sender.tab.id);
        return;
    }

    // Update Extension (native, no relay server needed — update-extension-
    // native.js's toolbar button). The native host (updater/update.bat,
    // registered once via updater/register.bat) does the actual download +
    // file overwrite outside the browser sandbox; this just asks it to run
    // and, once real new code is on disk, reloads it in. A response only
    // ever comes back when nothing changed or the host failed — a real
    // update reloads the tab + this extension before ever getting the
    // chance to reply, so the click's own tab never ends up stuck on
    // stale code waiting for a manual refresh.
    if (message?.type === "CHECK_FOR_UPDATE_NATIVE") {
        chrome.runtime.sendNativeMessage("com.tthelper.updater", { action: "update" }, (result) => {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, reason: chrome.runtime.lastError.message });
                return;
            }
            if (result?.ok && result.updated) {
                console.log("🔄 Extension updated via native host — reloading");
                if (sender.tab?.id) chrome.tabs.reload(sender.tab.id);
                chrome.runtime.reload();
                return; // reload() tears this context down — no sendResponse after it
            }
            sendResponse(result || { ok: false, reason: "no response from the updater" });
        });
        return true; // async sendResponse — keep the channel open
    }

});

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

// Picks whichever frame actually needs scrolling: the one with the most
// overflow (scrollHeight beyond its own clientHeight). On an ordinary
// (non-frameset) page there's only one frame, so this always resolves to
// the top frame — identical to the old top-frame-only behavior. Exposed
// as a pure function (no chrome.* calls) so it's unit-testable directly.
function pickTargetFrame(frameResults) {
    const topFrame = frameResults.find(f => f.frameId === 0);
    return frameResults.reduce((best, f) => {
        const bestOverflow = best.result.scrollHeight - best.result.clientHeight;
        const overflow     = f.result.scrollHeight - f.result.clientHeight;
        return overflow > bestOverflow ? f : best;
    }, topFrame);
}

// canvasWidth/canvasHeight in device px, plus per-slice crop/paste info
// when the target is a child frame (needs its on-screen rect within the
// top frame's viewport; null rect means "just use the top frame instead,
// full-viewport slices" — same shape chosen either way so callers don't
// branch on it). Pure function, unit-testable without chrome.* mocking.
function computeCaptureGeometry(topFrame, target, rect) {
    const dpr = topFrame.result.dpr;
    const canvasWidth = Math.round(topFrame.result.clientWidth * dpr);

    if (target.frameId === topFrame.frameId || !rect) {
        return {
            canvasWidth,
            canvasHeight: Math.round(target.result.scrollHeight * dpr),
            sliceViewportHeight: target.result.clientHeight,
            cropRectFor: () => null, // top-frame path never crops — plain full-slice draw
        };
    }

    const staticBelow = topFrame.result.clientHeight - rect.top - rect.height;
    const canvasHeight = Math.round((rect.top + target.result.scrollHeight + staticBelow) * dpr);
    return {
        canvasWidth,
        canvasHeight,
        sliceViewportHeight: target.result.clientHeight,
        cropRectFor: (sliceIndex) => sliceIndex === 0 ? null : {
            cropRect: { x: rect.left * dpr, y: rect.top * dpr, width: rect.width * dpr, height: rect.height * dpr },
            pasteY: Math.round((rect.top + sliceIndex * target.result.clientHeight) * dpr),
        },
    };
}

async function findChildFrameRect(tabId, frameName) {
    const [{ result: rect }] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: (name) => {
            for (const el of document.querySelectorAll("frame,iframe")) {
                try {
                    if (el.contentWindow && el.contentWindow.name === name) {
                        const r = el.getBoundingClientRect();
                        return { left: r.left, top: r.top, width: r.width, height: r.height };
                    }
                } catch (e) { /* cross-origin, skip */ }
            }
            return null;
        },
        args: [frameName]
    });
    return rect;
}

async function runFullPageCapture(tab) {
    if (fpcInProgress) return;
    fpcInProgress = true;
    try {
        // Independent of the screenshot flow below -- runs alongside it,
        // not blocking on its multi-second scroll-and-stitch process.
        fpcExtraCaptures.forEach(capture => capture(tab));

        // allFrames — Tradetech's schedule-edit page is a real <frameset>:
        // the top document never scrolls (it's the empty frameset shell),
        // the actual content lives in a named child frame (fr1/fr2, see
        // upload-proof-relay.js's findSupportDocsButton() comment). Without
        // this, only the top frame's (non-existent) scroll was measured,
        // so the whole slice loop degenerated to one screenshot — silently
        // dropping everything below the fold inside the real content frame.
        const frameResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => ({
                scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
                clientHeight: window.innerHeight,
                clientWidth:  window.innerWidth,
                dpr:          window.devicePixelRatio || 1,
                frameName:    window.name || "",
                originalX:    window.scrollX,
                originalY:    window.scrollY,
            })
        });

        const topFrame = frameResults.find(f => f.frameId === 0);
        let target = pickTargetFrame(frameResults);

        // ponytail: only the single frame with the most overflow gets
        // scrolled/stitched — a page with two independently-scrollable
        // frames only fully captures the taller one. Matches Tradetech's
        // real layout (one scrollable content frame under a static
        // toolbar frame). Upgrade path if that ever changes: repeat the
        // crop-and-paste per additional scrollable frame.
        let rect = null;
        if (target.frameId !== topFrame.frameId) {
            rect = await findChildFrameRect(tab.id, target.result.frameName);
            if (!rect) {
                console.warn("[FullPageCapture] target frame's on-screen rect not found (nested deeper than one level, or unnamed) — falling back to top-frame-only capture");
                target = topFrame;
            }
        }

        const geometry = computeCaptureGeometry(topFrame, target, rect);
        const { canvasWidth, canvasHeight, sliceViewportHeight } = geometry;

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
        // restored in the finally block below, even on error. Top-frame-
        // only, same as before — out of scope for the iframe-reach fix.
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
            const slices = Math.max(1, Math.ceil(target.result.scrollHeight / sliceViewportHeight));
            for (let i = 0; i < slices; i++) {
                const scrollY = Math.min(i * sliceViewportHeight, target.result.scrollHeight - sliceViewportHeight);

                await chrome.scripting.executeScript({
                    target: { tabId: tab.id, frameIds: [target.frameId] },
                    func: (y) => window.scrollTo(0, y),
                    args: [scrollY]
                });

                // ponytail: fixed delay, no scroll-completion/lazy-image-load
                // detection. Upgrade path if a real page proves flaky: double
                // rAF or a short MutationObserver-based debounce before capture.
                await sleep(FPC_SLICE_DELAY_MS);

                const dataUrl = await captureWithRetry(tab.windowId);

                const crop = geometry.cropRectFor(i);
                const sliceResp = await sendToTab(tab.id, crop
                    ? { type: "FPC_SLICE", dataUrl, cropRect: crop.cropRect, pasteY: crop.pasteY }
                    : { type: "FPC_SLICE", dataUrl, y: Math.round(scrollY * topFrame.result.dpr) });
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
            target: { tabId: tab.id, frameIds: [target.frameId] },
            func: (x, y) => window.scrollTo(x, y),
            args: [target.result.originalX, target.result.originalY]
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
