// ============================================================
//  highlighter.js
//  Four independent highlighter "slots", each its own keyboard
//  shortcut + color, both assigned from the Highlighter settings panel
//  (highlighter-settings.js, Tradetech-only). Trigger a slot on a text
//  selection → highlights it in that slot's color. Click an existing
//  highlight → un-highlights it. Runs on every site, but does nothing
//  at all unless the master switch is turned on in that settings panel
//  — see highlightEnabled below.
//
//  TWO independent shortcut mechanisms, both live at once:
//   1. Self-service (primary): the settings panel records a raw key
//      combo (any key the user actually presses in the panel) into
//      chrome.storage.local ("ttHighlightShortcuts"), and the plain
//      keydown listener below matches against it directly — assigned
//      entirely from our own tool, no browser settings page involved.
//      Works for anything the browser itself doesn't already reserve.
//   2. chrome.commands (manifest.json's "commands": highlight-1..4,
//      background.js relays them as TOGGLE_HIGHLIGHT_SHORTCUT messages)
//      — handled by the browser itself, one level above page scripts,
//      so a shortcut manually assigned to it in chrome://extensions/
//      shortcuts can claim a normally browser-reserved combo (like
//      Ctrl+D — confirmed live, this is the only way that specific
//      class of key actually works reliably; a page-level keydown +
//      preventDefault() cannot suppress a reserved combo, which is
//      exactly the "fighting with Edge Ctrl+D" bug this whole thing
//      started from). Still the documented fallback for that one case.
//  No collision between the two: when a combo IS bound at the
//  chrome.commands level, the browser claims that keystroke before it
//  ever reaches this page's own keydown listener at all, so recording
//  the same combo in both places harmlessly never double-fires.
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
//  One named Highlight + ::highlight() rule per slot, so each slot's
//  color is independent of the others.
//
//  ponytail: 4 fixed slots, not an arbitrary user-defined count —
//  matches a classic multi-color highlighter set. Upgrade path if more
//  are ever wanted: add another "highlight-N" entry to manifest.json's
//  "commands" (Chrome only auto-suggests a shortcut for the first
//  handful; the rest are exactly as manually-bindable as slot 1 is
//  today) and one more entry to HIGHLIGHT_SLOTS/DEFAULT_COLORS below.
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

// Matches manifest.json's "commands" names exactly — each is both the
// chrome.commands identifier AND (prefixed "tt-") the CSS Custom
// Highlight API registration name.
const HIGHLIGHT_SLOTS = ["highlight-1", "highlight-2", "highlight-3", "highlight-4"];
const DEFAULT_COLORS = {
    "highlight-1": "#ffff00", // yellow
    "highlight-2": "#90ee90", // light green
    "highlight-3": "#ff8fc7", // pink
    "highlight-4": "#87ceeb", // sky blue
};

function highlightName(slot) {
    return `tt-${slot}`;
}

// slot -> (id -> Range). Each slot's own CSS.highlights entry is
// rebuilt from its own map on every add/remove — kept separate per
// slot so one slot's highlights never affect another's color/paint.
const activeRanges = new Map(HIGHLIGHT_SLOTS.map(slot => [slot, new Map()]));

// This feature's master on/off switch, and each slot's color — both
// live in chrome.storage.local (shared across every origin this file
// runs on, unlike Tradetech-only localStorage) since the Highlighter
// settings panel only exists on Tradetech but this file runs
// everywhere. Cached + kept live via onChanged rather than re-reading
// storage on every keypress/click.
// Starts true (same default as the stored value) so a shortcut pressed
// before the async storage read below finishes isn't silently dropped.
let highlightEnabled = true;
let slotColors = { ...DEFAULT_COLORS };
let slotShortcuts = {}; // slot -> { ctrl, shift, alt, meta, key } | undefined (none recorded yet)

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("ttHighlightEnabled" in changes) {
        // Default ON: missing/undefined means "never explicitly turned
        // off", not "off" — this feature should just work everywhere out
        // of the box, not need a manual enable step before it does anything.
        const wasEnabled = highlightEnabled;
        highlightEnabled = changes.ttHighlightEnabled.newValue !== false;
        if (highlightEnabled && !wasEnabled) restoreHighlights(); // turned on mid-page — show saved ones without a reload
    }
    if ("ttHighlightColors" in changes) {
        slotColors = { ...DEFAULT_COLORS, ...(changes.ttHighlightColors.newValue || {}) };
        injectHighlightStyle();
    }
    if ("ttHighlightShortcuts" in changes) {
        slotShortcuts = changes.ttHighlightShortcuts.newValue || {};
    }
});

// True when `event` is exactly the recorded combo for `desc` — all
// four modifiers compared explicitly (not just the ones the user held
// down when recording), so e.g. a bare "Y" recording never matches a
// Ctrl+Y keypress too.
//
// Key compared two ways: event.key (what the key types) OR the physical
// key from event.code — Shift+1 types "!", Alt+letter types a symbol
// on some layouts, so event.key alone missed combos saved as "1"/"h".
function eventMatchesShortcut(event, desc) {
    if (!desc || !desc.key || !event.key) return false; // Chrome autofill fires keydown with no .key
    const physical = (event.code || "").replace(/^(Key|Digit|Numpad)/, "").toLowerCase();
    return !!event.ctrlKey === !!desc.ctrl
        && !!event.shiftKey === !!desc.shift
        && !!event.altKey === !!desc.alt
        && !!event.metaKey === !!desc.meta
        && (event.key.toLowerCase() === desc.key || physical === desc.key);
}

// Self-service path (see file header) — every keystroke on every site
// gets checked against whatever's been recorded, so this has to stay
// cheap: a plain object lookup per slot, no DOM work unless something
// actually matches. Capture phase on window so a page that
// stopPropagation()s its own keydowns can't swallow ours first.
window.addEventListener("keydown", (event) => {
    for (const slot of HIGHLIGHT_SLOTS) {
        if (!eventMatchesShortcut(event, slotShortcuts[slot])) continue;
        // Only eat the key when it actually highlighted something — a
        // plain-letter shortcut must still type normally with no selection.
        if (createHighlightFromSelection(slot)) event.preventDefault();
        return;
    }
}, true);

function refreshHighlightPaint(slot) {
    CSS.highlights.set(highlightName(slot), new Highlight(...activeRanges.get(slot).values()));
}

// One <style> element, regenerated (not re-appended) whenever colors
// change, so every slot's ::highlight() rule always matches the
// latest chosen colors without stacking up duplicate <style> tags.
function injectHighlightStyle() {
    let style = document.getElementById("tt-highlight-style");
    if (!style) {
        style = document.createElement("style");
        style.id = "tt-highlight-style";
        (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = HIGHLIGHT_SLOTS
        .map(slot => `::highlight(${highlightName(slot)}) { background-color: ${slotColors[slot]}; }`)
        .join("\n");
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

// ── Create on a slot's shortcut ──────────────────────────────
// Triggered via chrome.commands (background.js relays it here as a
// runtime message), NOT a raw keydown listener. Ctrl+D — the shortcut
// slot 1 used to hardcode — is a browser-reserved combo (bookmark this
// page); a page-script keydown + preventDefault() can't reliably
// suppress it, so it fought with the browser's own action (reported
// live: "our Ctrl+D is fighting with Edge Ctrl+D"). chrome.commands is
// handled by the browser itself, one level above page scripts, so a
// manually-assigned shortcut (chrome://extensions/shortcuts) actually
// wins instead of merely racing it — confirmed live, Ctrl+D reassigned
// there works. See manifest.json's "commands" key for current bindings.
//
// Gated on highlightEnabled (see above) — same flag everywhere,
// Tradetech included, so the master switch actually means the same
// thing on every site rather than only being enforced where the
// settings panel happens to live.
function createHighlightFromSelection(slot) {
    if (!highlightEnabled || !window.Highlight || !CSS.highlights) return false;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const text = selection.toString();
    if (!text.trim()) return false;

    // Cloned so it stays valid once the Selection itself is cleared below —
    // Selection.getRangeAt() can hand back a reference tied to the
    // selection's own internal lifecycle, not a standalone snapshot.
    const range = selection.getRangeAt(0).cloneRange();
    const { prefix, suffix } = captureContext(range);
    const id = crypto.randomUUID();

    selection.removeAllRanges();

    activeRanges.get(slot).set(id, range);
    refreshHighlightPaint(slot);

    saveHighlight({ id, slot, exact: text, prefix, suffix });
    return true;
}

// Runs in every frame (manifest all_frames) and background.js's relay
// reaches all of them — only the focused frame acts, so an old leftover
// selection in some other frame/iframe doesn't get highlighted instead.
chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_HIGHLIGHT_SHORTCUT" && HIGHLIGHT_SLOTS.includes(message.slot) && document.hasFocus()) {
        createHighlightFromSelection(message.slot);
    }
});

// ── Remove on click ──────────────────────────────────────────
// No DOM element to attach a listener to (nothing was inserted) — find
// whichever stored range, in whichever slot, contains the clicked
// point instead.
document.addEventListener("click", (event) => {
    // A drag-select or double-click that starts inside a highlight also
    // fires "click" — that's the user selecting text, not asking to
    // remove the highlight (was wiping highlights "randomly").
    if (event.detail > 1) return;
    if (!window.getSelection()?.isCollapsed) return;
    let caret = null;
    for (const [slot, ranges] of activeRanges) {
        if (ranges.size === 0) continue;
        if (!caret) {
            caret = document.caretRangeFromPoint(event.clientX, event.clientY);
            if (!caret) return;
        }

        for (const [id, range] of ranges) {
            let inside;
            try {
                inside = range.isPointInRange(caret.startContainer, caret.startOffset);
            } catch (e) {
                continue; // range's nodes detached from the document since it was created
            }
            if (!inside) continue;

            ranges.delete(id);
            refreshHighlightPaint(slot);
            removeHighlight(id);
            return;
        }
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

    const stored = await new Promise((resolve) =>
        chrome.storage.local.get(["ttHighlightEnabled", "ttHighlightColors", "ttHighlightShortcuts"], resolve));
    highlightEnabled = stored.ttHighlightEnabled !== false; // default ON — see onChanged listener above
    slotColors = { ...DEFAULT_COLORS, ...(stored.ttHighlightColors || {}) };
    slotShortcuts = stored.ttHighlightShortcuts || {};

    injectHighlightStyle(); // inert with nothing highlighted yet — safe to always add, even if off
    if (!highlightEnabled) return; // off — don't restore old highlights either, not just skip creating new ones
    restoreHighlights();
})();

// Idempotent (keyed by saved id) — safe to call again when the master
// switch is turned back on mid-page.
async function restoreHighlights() {
    if (!window.Highlight || !CSS.highlights) return;
    try {
        const list = await loadHighlights();
        for (const entry of list) {
            // Entries saved before multi-slot existed have no `slot` — treat
            // them as slot 1 (this file's original single highlight) rather
            // than silently dropping pre-existing highlights on upgrade.
            const slot = HIGHLIGHT_SLOTS.includes(entry.slot) ? entry.slot : HIGHLIGHT_SLOTS[0];
            try {
                const range = findRange(entry);
                if (!range) {
                    console.warn("[Highlighter] could not restore:", entry.exact.slice(0, 40));
                    continue;
                }
                activeRanges.get(slot).set(entry.id, range);
            } catch (err) {
                console.warn("[Highlighter] restore failed for one highlight:", err);
            }
        }
        HIGHLIGHT_SLOTS.forEach(refreshHighlightPaint);
    } catch (err) {
        console.warn("[Highlighter] restore skipped:", err); // never break the page
    }
}
