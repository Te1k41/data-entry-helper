// ============================================================
//  highlighter.js
//  A keyboard shortcut (manifest.json "commands", default Ctrl+Shift+H)
//  on a text selection → highlights it yellow. Click an existing
//  highlight → un-highlights it. Runs on every site, but does nothing
//  at all unless "Enable Ctrl+D Highlight" is turned on in the Custom
//  Rules settings panel (Tradetech only) — see highlightEnabled below.
//  Persists per-page via chrome.storage.local using a simplified
//  W3C TextQuoteSelector ({exact, prefix, suffix}) since a DOM
//  Range can't be serialized directly across reloads.
//
//  Uses the CSS Custom Highlight API (CSS.highlights + ::highlight())
//  instead of wrapping text in <mark> elements — paints the highlight
//  purely at render time, with ZERO DOM mutation of the page itself.
//  A Range can span multiple elements (e.g. dragged across several
//  <td>/<tr> in a schedule table) with no special-casing needed here;
//  the old <mark>-wrapping approach had to split per text node to
//  avoid corrupting table structure — moot now, nothing is inserted.
//
//  ponytail: best-effort text-quote matching only — not resilient
//  to major page-structure changes. Full W3C Web Annotation range
//  selector (RangeSelector + refinement) is the named upgrade path,
//  not built now.
//
//  KNOWN GAP: does not run inside Chrome's built-in PDF viewer
//  (sandboxed renderer, extensions cannot inject into it) — accepted,
//  documented, not solvable from a content script.
// ============================================================

const CONTEXT_RADIUS = 30;
const HIGHLIGHT_NAME = "tt-highlight";

// id -> Range, the live source of truth CSS.highlights.set() is
// rebuilt from on every add/remove.
const activeRanges = new Map();

// This feature's own on/off switch, "Enable Ctrl+D Highlight" in the
// Custom Rules settings panel — but that panel only exists on
// Tradetech, and its storage (CustomRules, localStorage) is per-origin,
// so it could never be seen from any other site this file runs on.
// custom-rules.js mirrors it into chrome.storage.local (shared across
// every origin) specifically so this one flag can be checked here,
// everywhere, from a single source of truth. Cached + kept live via
// onChanged rather than re-reading storage on every keypress. Starts
// resolved false (off) until the initial read below finishes — no
// window where a stale/default-on value could create a highlight
// before this file has actually checked.
let highlightEnabled = false;
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "ttHighlightEnabled" in changes) {
        highlightEnabled = !!changes.ttHighlightEnabled.newValue;
    }
});

function refreshHighlightPaint() {
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...activeRanges.values()));
}

function injectHighlightStyle() {
    const style = document.createElement("style");
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: yellow; }`;
    document.head.appendChild(style);
}

function storageKey() {
    return `tt-highlight:${location.href}`;
}

function loadHighlights() {
    return new Promise((resolve) => {
        chrome.storage.local.get(storageKey(), (data) => resolve(data[storageKey()] || []));
    });
}

async function saveHighlight(entry) {
    const key = storageKey();
    const list = await loadHighlights();
    list.push(entry);
    chrome.storage.local.set({ [key]: list });
}

async function removeHighlight(id) {
    const key = storageKey();
    const list = await loadHighlights();
    chrome.storage.local.set({ [key]: list.filter((h) => h.id !== id) });
}

function captureContext(range) {
    const before = document.createRange();
    before.setStart(document.body, 0);
    before.setEnd(range.startContainer, range.startOffset);

    const after = document.createRange();
    after.setStart(range.endContainer, range.endOffset);
    after.setEnd(document.body, document.body.childNodes.length);

    return {
        prefix: before.toString().slice(-CONTEXT_RADIUS),
        suffix: after.toString().slice(0, CONTEXT_RADIUS),
    };
}

// ── Create on the toggle-highlight shortcut ──────────────────
// Triggered via chrome.commands (background.js relays it here as a
// runtime message), NOT a raw keydown listener. Ctrl+D — the shortcut
// this used to hardcode — is a browser-reserved combo (bookmark this
// page); a page-script keydown + preventDefault() can't reliably
// suppress it, so it fought with the browser's own action (reported
// live: "our Ctrl+D is fighting with Edge Ctrl+D"). chrome.commands is
// handled by the browser itself, one level above page scripts, so a
// manually-assigned shortcut (chrome://extensions/shortcuts) actually
// wins instead of merely racing it. See manifest.json's "commands" key
// for the current default binding.
//
// Gated on highlightEnabled (see above) — same flag everywhere,
// Tradetech included, so the toggle actually means the same thing on
// every site rather than only being enforced where the settings panel
// happens to live.
function createHighlightFromSelection() {
    if (!highlightEnabled) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const text = selection.toString();
    if (!text.trim()) return;

    // Cloned so it stays valid once the Selection itself is cleared below —
    // Selection.getRangeAt() can hand back a reference tied to the
    // selection's own internal lifecycle, not a standalone snapshot.
    const range = selection.getRangeAt(0).cloneRange();
    const { prefix, suffix } = captureContext(range);
    const id = crypto.randomUUID();

    selection.removeAllRanges();

    activeRanges.set(id, range);
    refreshHighlightPaint();

    saveHighlight({ id, exact: text, prefix, suffix });
}

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_HIGHLIGHT_SHORTCUT") createHighlightFromSelection();
});

// ── Remove on click ──────────────────────────────────────────
// No DOM element to attach a listener to (nothing was inserted) — find
// whichever stored range, if any, contains the clicked point instead.
document.addEventListener("click", (event) => {
    if (activeRanges.size === 0) return;
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (!caret) return;

    for (const [id, range] of activeRanges) {
        let inside;
        try {
            inside = range.isPointInRange(caret.startContainer, caret.startOffset);
        } catch (e) {
            continue; // range's nodes detached from the document since it was created
        }
        if (!inside) continue;

        activeRanges.delete(id);
        refreshHighlightPaint();
        removeHighlight(id);
        return;
    }
});

// ── Restore on load ─────────────────────────────────────────
function findRange(entry) {
    // TreeWalker over text nodes (not innerText) — textContent offsets
    // map directly back to (node, offset) pairs; innerText's rendered
    // whitespace/line-break collapsing does not.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = "";
    let node;
    while ((node = walker.nextNode())) {
        nodes.push({ node, start: text.length });
        text += node.nodeValue;
    }

    let idx = text.indexOf(entry.prefix + entry.exact + entry.suffix);
    let matchStart;
    if (idx !== -1) {
        matchStart = idx + entry.prefix.length;
    } else {
        idx = text.indexOf(entry.exact); // fall back to exact-only match
        if (idx === -1) return null;
        matchStart = idx;
    }

    const start = locate(nodes, matchStart);
    const end = locate(nodes, matchStart + entry.exact.length);
    if (!start || !end) return null;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
}

function locate(nodes, globalOffset) {
    for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].start <= globalOffset) {
            return { node: nodes[i].node, offset: globalOffset - nodes[i].start };
        }
    }
    return null;
}

(async () => {
    if (!window.Highlight || !CSS.highlights) {
        console.warn("[Highlighter] CSS Custom Highlight API not available in this browser — highlighting disabled");
        return;
    }
    injectHighlightStyle(); // inert with nothing highlighted yet — safe to always add

    const stored = await new Promise((resolve) => chrome.storage.local.get("ttHighlightEnabled", resolve));
    highlightEnabled = !!stored.ttHighlightEnabled;
    if (!highlightEnabled) return; // off — don't restore old highlights either, not just skip creating new ones

    try {
        const list = await loadHighlights();
        for (const entry of list) {
            try {
                const range = findRange(entry);
                if (!range) {
                    console.warn("[Highlighter] could not restore:", entry.exact.slice(0, 40));
                    continue;
                }
                activeRanges.set(entry.id, range);
            } catch (err) {
                console.warn("[Highlighter] restore failed for one highlight:", err);
            }
        }
        refreshHighlightPaint();
    } catch (err) {
        console.warn("[Highlighter] restore skipped:", err); // never break the page
    }
})();
