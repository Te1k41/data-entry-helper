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
                // Reply first and reload ~2s later, so the button can show
                // "Updated — reloading…" instead of the page just blinking.
                // ttJustUpdated lets the reloaded page say it worked.
                chrome.storage.local.set({ ttJustUpdated: { at: Date.now(), commit: result.commit, commits: [] } });
                sendResponse(result);
                setTimeout(() => {
                    if (sender.tab?.id) chrome.tabs.reload(sender.tab.id);
                    chrome.runtime.reload();
                }, 2000);
                return;
            }
            sendResponse(result || { ok: false, reason: "no response from the updater" });
        });
        return true; // async sendResponse — keep the channel open
    }

    // Highlighter settings panel (highlighter-settings.js, Tradetech-only)
    // needs the REAL currently-bound shortcut per slot — chrome.commands
    // isn't available to content scripts at all, only extension pages and
    // the background/service worker, so it has to ask here instead.
    if (message?.type === "GET_HIGHLIGHT_SHORTCUTS") {
        chrome.commands.getAll((commands) => {
            sendResponse(commands
                .filter(c => c.name.startsWith("highlight-"))
                .map(c => ({ name: c.name, shortcut: c.shortcut || "" })));
        });
        return true; // async sendResponse
    }

    // Same panel's "Change shortcuts" button — chrome://extensions/shortcuts
    // can only be opened via chrome.tabs.create from an extension context,
    // never by a content script navigating there itself (blocked as a
    // privileged URL). Edge recognizes chrome:// extension pages as an
    // alias of its own edge:// equivalent, so one URL covers both browsers.
    if (message?.type === "OPEN_SHORTCUTS_PAGE") {
        chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
        return;
    }

});

// ── Highlighter shortcuts (chrome.commands, not a raw keydown listener) ──
// Ctrl+D used to be caught via a content-script keydown + preventDefault(),
// but that's a page-level shortcut, and Ctrl+D is a browser-reserved one
// (bookmark this page) — preventDefault() from a page script can't
// reliably suppress it, so it kept firing alongside our own highlight
// (reported live: "our Ctrl+D is fighting with Edge Ctrl+D"). A
// chrome.commands binding is handled by the browser itself, one level
// above page scripts, so once a user manually assigns a command's
// shortcut to a normally-reserved combo (chrome://extensions/shortcuts
// or edge://extensions/shortcuts), the browser lets that command claim
// it instead — the only sanctioned way to actually override one
// (confirmed live: Ctrl+D reassigned there does work).
//
// Four slots (manifest.json's "commands"), each its own independent
// shortcut + color (color picked in the Highlighter settings panel,
// not here) — only the first ships a suggested default (Ctrl+Shift+H,
// unclaimed by Chrome/Edge); a "suggested_key" can't auto-bind to an
// already-reserved combo anyway, so the rest start unbound and every
// slot (including the first, if a different key is wanted) is exactly
// as manually assignable as Ctrl+D was above.
chrome.commands.onCommand.addListener((command, tab) => {
    if (command.startsWith("highlight-") && tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_HIGHLIGHT_SHORTCUT", slot: command });
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

const FPC_OVERLAP_PX     = 1;          // each tile overlaps the previous by 1 CSS px — absorbs sub-pixel
                                        // landing drift (dpr 1.25/1.5); the overlap is identical pixels, invisible

let fpcInProgress = false; // ponytail: global lock, not per-tab — one capture per profile at a time
                            // is the only realistic case here; per-tab lock is the upgrade path

chrome.action.onClicked.addListener((tab) => {
    runFullPageCapture(tab).catch((err) => {
        console.error("[FullPageCapture]", err);
        reportCaptureError(tab.id, err.message);
    });
});

// Picks whichever frame actually needs scrolling: the one with the most
// overflow, horizontal + vertical combined (scrollWidth/scrollHeight
// beyond its own contentWidth/contentHeight). On an ordinary
// (non-frameset) page there's only one frame, so this always resolves to
// the top frame — identical to the old top-frame-only behavior. Exposed
// as a pure function (no chrome.* calls) so it's unit-testable directly.
function pickTargetFrame(frameResults) {
    const topFrame = frameResults.find(f => f.frameId === 0);
    const overflowOf = (r) => Math.max(0, r.scrollWidth - r.contentWidth) + Math.max(0, r.scrollHeight - r.contentHeight);
    return frameResults.reduce((best, f) =>
        overflowOf(f.result) > overflowOf(best.result) ? f : best, topFrame);
}

// canvasWidth/canvasHeight in device px, the column/row step size (each
// EXCLUDING that frame's own scrollbar strip — document.documentElement.
// clientWidth/clientHeight, not window.innerWidth/innerHeight, deliberately;
// the difference between the two IS the scrollbar's own thickness, so
// using the smaller "content" measurement is what keeps the scrollbar out
// of the stitched result instead of needing a separate crop step for it),
// plus per-tile crop/paste info. `backgroundRect` is null when the target
// IS the whole tab viewport (nothing static surrounds it to pre-fill);
// otherwise it's the one-time full-viewport snapshot the caller should
// draw at canvas (0,0) BEFORE the main tile loop, to fill in whatever's
// outside the target frame's own footprint (header/footer/side frames) —
// the main loop's tiles then fully overpaint the target's own footprint
// on top of it. Pure function, unit-testable without chrome.* mocking.
function computeCaptureGeometry(topFrame, target, rect) {
    const dpr = topFrame.result.dpr;
    const t = target.result;
    const isTopFrame = target.frameId === topFrame.frameId || !rect;

    const originLeft = isTopFrame ? 0 : rect.left;
    const originTop  = isTopFrame ? 0 : rect.top;
    const staticRight = isTopFrame ? 0 : topFrame.result.clientWidth  - rect.left - rect.width;
    const staticBelow = isTopFrame ? 0 : topFrame.result.clientHeight - rect.top  - rect.height;

    // Every device-px quantity a tile's position is BUILT FROM gets rounded
    // exactly once, here, and every tile then reuses these same integers —
    // never re-deriving a position by rounding col*contentWidth*dpr fresh
    // per tile. Independent per-tile rounding drifts apart from the fixed
    // crop width as col/row grows (dpr=1.25, contentWidth=983 → tile 1
    // lands at round(983*1.25)=1229 but the crop is only round(983*1.25)
    // =1229 wide too... the SAME number computed twice can still diverge
    // once you're 2+ tiles in, e.g. round(2*983*1.25)=2458 vs
    // 2*round(983*1.25)=2458 — fine there, but off in general for other
    // step/dpr combinations) — a real, live-reported bug ("misaligned/
    // seams between tiles"), worst on non-integer display scaling
    // (125%/150% Windows scaling is dpr 1.25/1.5) and confirmed the root
    // cause by hand-tracing the arithmetic.
    const originLeftPx    = Math.round(originLeft * dpr);
    const originTopPx     = Math.round(originTop  * dpr);
    const stepX           = Math.round(t.contentWidth  * dpr);
    const stepY           = Math.round(t.contentHeight * dpr);
    const contentWidthPx  = Math.round(t.scrollWidth  * dpr);
    const contentHeightPx = Math.round(t.scrollHeight * dpr);

    return {
        canvasWidth:  originLeftPx + contentWidthPx  + Math.round(staticRight * dpr),
        canvasHeight: originTopPx  + contentHeightPx + Math.round(staticBelow * dpr),
        colStep: t.contentWidth,
        rowStep: t.contentHeight,
        backgroundRect: isTopFrame ? null : {
            width:  Math.round(topFrame.result.clientWidth  * dpr),
            height: Math.round(topFrame.result.clientHeight * dpr),
        },
        // Pasted at where the frame ACTUALLY scrolled to (read back right
        // before the screenshot), not where we asked it to go — a page can
        // land somewhere else (scroll snapping, content that grew/shrank
        // since it was measured, sub-pixel snapping at non-integer dpr),
        // and pasting at the predicted spot is exactly what tore seams.
        // No clamp to the far edge either: the real position already IS
        // the edge for the last tile, and a clamp built from the rounded
        // step was off by one device row at dpr 1.5 (1237.5 rounds to
        // 1238). Anything past the canvas edge is just clipped by drawImage.
        cropRectFor: (actualX, actualY) => {
            const pasteXOffset = Math.round(actualX * dpr);
            const pasteYOffset = Math.round(actualY * dpr);
            return {
                cropRect: { x: originLeftPx, y: originTopPx, width: stepX, height: stepY },
                pasteX: originLeftPx + pasteXOffset,
                pasteY: originTopPx  + pasteYOffset,
            };
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

// Floating elements (site headers, chat bubbles, our own buttons) would
// otherwise be stamped into every tile. Like GoFullPage, each one shows up
// ONCE, where it belongs in a full-page picture:
//   "first"  (top row of tiles)    — ones pinned to the top half of the
//                                     screen (site header, Rename button)
//   "middle"                        — none
//   "last"   (bottom row of tiles)  — ones pinned to the bottom half
//                                     (chat bubble, cookie bar)
//   "only"   (page fits one row)   — all of them
//
// "Floating" is decided by BEHAVIOR, not CSS: nudge the page 1px and see
// what didn't move with it. Catches position:fixed, stuck position:sticky,
// headers that only turn fixed once you scroll (live: cmacgm.com), and
// "fake sticky" headers that JS re-positions on every scroll — none of
// which a computed-style check reliably finds (live: zim.com's header
// slipped past it). A sticky element still sitting in its natural spot
// moves with the page, so it's correctly left alone as content.
// Candidates = every fixed/sticky element (shadow roots included) + whatever
// is under a grid of points along the top/bottom edges of the screen, plus
// their ancestors. Frames that can't scroll fall back to "position:fixed".
//
// Hidden with opacity:0 !important + transition:none — unlike visibility,
// a child can't override opacity, and site CSS with !important can't beat
// an inline !important. Original inline values are kept in an isolated-
// world Map (survives between executeScript calls in the same frame) for
// the restore at the end. Once hidden, an element only comes back when
// "last"/"only" wants it, so a header that slides away while we nudge
// isn't caught mid-animation. Resolves after the change has painted, with
// where the frame really is scrolled to.
// ponytail: top/bottom halves only — a left/right-pinned side widget shows
// on the first/last ROW of every column. Left/right split is the upgrade.
// Runs inside the page (executeScript) — must stay self-contained.
async function fpcHideFloatingAndRead(mode) {
    const saved = globalThis.__ttFpcSaved || (globalThis.__ttFpcSaved = new Map());
    const se = document.scrollingElement || document.documentElement;
    const W = window.innerWidth, H = window.innerHeight;
    const frame = () => new Promise((r) => { setTimeout(r, 100); requestAnimationFrame(() => requestAnimationFrame(r)); });
    const parentOf = (el) => el.parentElement || (el.getRootNode() instanceof ShadowRoot ? el.getRootNode().host : null);

    const cands = new Set();
    const walk = (root) => root.querySelectorAll("*").forEach((el) => {
        const p = getComputedStyle(el).position;
        if (p === "fixed" || p === "sticky") cands.add(el);
        if (el.shadowRoot) walk(el.shadowRoot);
    });
    walk(document);
    for (const y of [2, 40, 90, H - 90, H - 40, H - 2]) {
        for (let i = 0; i <= 10; i++) {
            for (let el of document.elementsFromPoint(Math.min(W - 1, i * W / 10), y)) {
                for (; el && el !== document.body && el !== document.documentElement; el = parentOf(el)) cands.add(el);
            }
        }
    }

    const before = new Map([...cands].map((el) => [el, el.getBoundingClientRect().top]));
    const y0 = window.scrollY;
    const dy = y0 + H < se.scrollHeight - 1 ? 1 : -1;
    window.scrollTo({ left: window.scrollX, top: y0 + dy, behavior: "instant" });
    await frame();
    const nudged = window.scrollY !== y0;
    const floating = new Set([...cands].filter((el) => nudged
        ? Math.abs(el.getBoundingClientRect().top - before.get(el)) < 0.5
        : getComputedStyle(el).position === "fixed"));
    if (nudged) {
        window.scrollTo({ left: window.scrollX, top: y0, behavior: "instant" });
        await frame();
    }

    const restore = (el) => {
        for (const [prop, value, priority] of saved.get(el)) {
            if (value) el.style.setProperty(prop, value, priority); else el.style.removeProperty(prop);
        }
        saved.delete(el);
    };
    for (const el of floating) {
        let inner = false;
        for (let p = parentOf(el); p && !inner; p = parentOf(p)) inner = floating.has(p);
        if (inner) continue; // outermost floating element only

        const r = el.getBoundingClientRect();
        const pinnedTop = r.top + r.height / 2 < H / 2;
        const show = mode === "only" || (mode === "first" && pinnedTop) || (mode === "last" && !pinnedTop);
        if (show) {
            if (saved.has(el)) restore(el);
        } else if (!saved.has(el)) {
            saved.set(el, ["opacity", "transition"].map((p) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]));
            el.style.setProperty("transition", "none", "important");
            el.style.setProperty("opacity", "0", "important");
        }
    }
    await frame();
    return { x: window.scrollX, y: window.scrollY };
}

// Puts back everything fpcHideFloatingAndRead() changed in this frame.
function fpcRestoreFloating() {
    const saved = globalThis.__ttFpcSaved;
    if (!saved) return;
    for (const [el, props] of saved) {
        for (const [prop, value, priority] of props) {
            if (value) el.style.setProperty(prop, value, priority); else el.style.removeProperty(prop);
        }
    }
    saved.clear();
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
            func: () => {
                // document.scrollingElement is the browser's OWN answer to
                // "which element is actually the page's scroll container" —
                // document.documentElement in standards mode, but
                // document.body in quirks mode (no <!DOCTYPE html>, common
                // on old sites — confirmed live: a shipmentlink.com page
                // with no doctype measured scrollWidth/scrollHeight as
                // exactly equal to clientWidth/clientHeight, i.e. "nothing
                // to scroll", when the page very much needed to scroll —
                // documentElement.scrollHeight doesn't reliably reflect the
                // true content height in quirks mode, body's does).
                // window.scrollTo() itself also follows scrollingElement in
                // both modes, so measuring the same element keeps this
                // consistent with what actually scrolls, instead of
                // guessing which one to hardcode per site.
                const se = document.scrollingElement || document.documentElement;
                return {
                    scrollWidth:  se.scrollWidth,
                    scrollHeight: se.scrollHeight,
                    // *.client* EXCLUDES that axis's own scrollbar strip
                    // (window.inner* does not) — using this as the step
                    // size is what keeps the scrollbar out of the stitched
                    // image, not a separate crop rule for it.
                    contentWidth:  se.clientWidth,
                    contentHeight: se.clientHeight,
                    clientWidth:  window.innerWidth,  // raw viewport size — only used for static-space-around-target math
                    clientHeight: window.innerHeight,
                    dpr:          window.devicePixelRatio || 1,
                    frameName:    window.name || "",
                    originalX:    window.scrollX,
                    originalY:    window.scrollY,
                };
            }
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
        const { canvasWidth, canvasHeight, colStep, rowStep, backgroundRect } = geometry;

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

        try {
            // One-time static-chrome background snapshot (header/footer/
            // side frames outside the target's own footprint) — only
            // needed when the target ISN'T the whole viewport. Captured at
            // whatever scroll position the target already happens to be
            // at; doesn't matter, the main loop below fully overpaints the
            // target's own footprint (including any of its own scrollbar-
            // strip remnants baked into this one snapshot) regardless.
            if (backgroundRect) {
                const bgDataUrl = await captureWithRetry(tab.windowId);
                const bgResp = await sendToTab(tab.id, { type: "FPC_SLICE", dataUrl: bgDataUrl, pasteX: 0, pasteY: 0 });
                if (!bgResp?.ok) throw new Error(bgResp?.error || "Could not draw background layer");
            }

            const maxX = Math.max(0, target.result.scrollWidth  - colStep);
            const maxY = Math.max(0, target.result.scrollHeight - rowStep);
            const totalTiles = Math.max(1, Math.ceil(target.result.scrollWidth / colStep)) * Math.max(1, Math.ceil(target.result.scrollHeight / rowStep)); // estimate, for the progress count
            let tileIndex = 0;
            console.log(`[FullPageCapture] ~${totalTiles} tiles (content ${target.result.scrollWidth}×${target.result.scrollHeight}px, step ${colStep}×${rowStep}px)`);

            // Each next tile is requested one step past where the previous
            // one ACTUALLY landed, not past where it was asked to go — a
            // tile that lands short (scroll snapping, sub-pixel snapping)
            // would otherwise leave a strip nobody captured between it and
            // the next one. Stops when a row/column reaches the far edge, or
            // stops advancing at all (page refuses to scroll further).
            const scrollAndRead = async (x, y, mode) => {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id, frameIds: [target.frameId] },
                    // behavior:"instant" — a page with CSS scroll-behavior:
                    // smooth would otherwise still be animating when the
                    // screenshot fires.
                    func: (x, y) => window.scrollTo({ left: x, top: y, behavior: "instant" }),
                    args: [x, y]
                });
                // ponytail: fixed delay, no scroll-completion/lazy-image-load
                // detection. Upgrade path if a real page proves flaky: double
                // rAF or a short MutationObserver-based debounce before capture.
                await sleep(FPC_SLICE_DELAY_MS);
                // Every frame — on a frameset page (Tradetech) the target is a
                // child frame with its own floating elements (our Toolbar).
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    func: fpcHideFloatingAndRead,
                    args: [mode],
                });
                return results.find(r => r.frameId === target.frameId).result;
            };

            let reqY = 0, prevRowY = -1;
            for (let row = 1; ; row++) {
                let reqX = 0, rowY = null, prevX = -1;
                for (let col = 1; ; col++) {
                    const firstRow = row === 1, lastRow = reqY >= maxY;
                    const mode = firstRow && lastRow ? "only" : firstRow ? "first" : lastRow ? "last" : "middle";
                    const at = await scrollAndRead(reqX, reqY, mode);
                    const dataUrl = await captureWithRetry(tab.windowId);
                    const { cropRect, pasteX, pasteY } = geometry.cropRectFor(at.x, at.y);
                    tileIndex++;
                    // Progress on the toolbar icon, not on the page — anything
                    // drawn on the page ends up in the screenshot (and a fixed
                    // badge gets hidden by the step above anyway).
                    chrome.action.setBadgeText({ tabId: tab.id, text: `${Math.min(99, Math.floor(tileIndex / totalTiles * 100))}%` });
                    const sliceResp = await sendToTab(tab.id, { type: "FPC_SLICE", dataUrl, cropRect, pasteX, pasteY });
                    if (!sliceResp?.ok) throw new Error(sliceResp?.error || `Could not draw tile row ${row} col ${col}`);

                    if (rowY === null) rowY = at.y;
                    if (reqX >= maxX || at.x >= maxX || at.x <= prevX) break;
                    prevX = at.x;
                    reqX = Math.min(at.x + colStep - FPC_OVERLAP_PX, maxX);
                }
                if (reqY >= maxY || rowY >= maxY || rowY <= prevRowY) break;
                prevRowY = rowY;
                reqY = Math.min(rowY + rowStep - FPC_OVERLAP_PX, maxY);
            }
        } finally {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: fpcRestoreFloating,
            }).catch(() => {}); // tab may have navigated/closed mid-capture — best effort only
        }

        await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [target.frameId] },
            func: (x, y) => window.scrollTo({ left: x, top: y, behavior: "instant" }),
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
        chrome.action.setBadgeText({ tabId: tab.id, text: "" });
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
