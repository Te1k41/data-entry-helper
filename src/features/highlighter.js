// ============================================================
//  highlighter.js
//  Ctrl+D on a text selection → wraps it in a yellow <mark>.
//  Click an existing <mark> → un-highlights it.
//  Persists per-page via chrome.storage.local using a simplified
//  W3C TextQuoteSelector ({exact, prefix, suffix}) since a DOM
//  Range can't be serialized directly across reloads.
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

// Wraps each text node the range touches SEPARATELY (one <mark> per
// node, all sharing `id`) instead of one extractContents()/insertNode()
// over the whole range. A single wrap over a range spanning multiple
// elements — e.g. a selection dragged across several <td>/<tr> in a
// schedule table — rips a partial table fragment out and reinserts it
// at one point, corrupting the table's rows/columns. Per-text-node subranges
// never cross an element boundary, so extraction/insertion always stays
// safely within one cell/element.
function wrapRange(range, id) {
    for (const { node, start, end } of getTextNodesInRange(range)) {
        const subRange = document.createRange();
        subRange.setStart(node, start);
        subRange.setEnd(node, end);

        const mark = document.createElement("mark");
        mark.dataset.ttHighlightId = id;
        mark.style.backgroundColor = "yellow";

        const contents = subRange.extractContents(); // always just this one text node — never crosses an element boundary
        mark.appendChild(contents);
        subRange.insertNode(mark);
    }
}

// Every text node the range intersects, with start/end offsets clipped
// to the range's own boundaries (so the middle nodes are taken whole,
// while the first/last nodes only take the portion actually selected).
// Collected up front, before any DOM mutation, so wrapping one node
// can't invalidate the offsets/references already captured for the rest.
function getTextNodesInRange(range) {
    const result = [];
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(
        root.nodeType === Node.TEXT_NODE ? root.parentNode : root,
        NodeFilter.SHOW_TEXT,
        { acceptNode: (n) => range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
    );

    let node;
    while ((node = walker.nextNode())) {
        const start = node === range.startContainer ? range.startOffset : 0;
        const end   = node === range.endContainer   ? range.endOffset   : node.nodeValue.length;
        if (start < end) result.push({ node, start, end });
    }
    return result;
}

function unwrap(mark) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
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

// ── Create on Ctrl+D ────────────────────────────────────────
document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey && event.key.toLowerCase() === "d")) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const text = selection.toString();
    if (!text.trim()) return;

    // Ctrl+D is normally "bookmark this page" — preventDefault() suppresses
    // that (needs real-Chrome verification across versions/OSes, not
    // testable from this environment).
    event.preventDefault();

    const range = selection.getRangeAt(0);
    const { prefix, suffix } = captureContext(range); // must run BEFORE wrapRange mutates the range
    const id = crypto.randomUUID();

    wrapRange(range, id);
    selection.removeAllRanges();

    saveHighlight({ id, exact: text, prefix, suffix });
});

// ── Remove on click (event delegation — highlights are added both
// live and on restore, so one delegated listener beats per-element
// listeners, same convention as this codebase's other delegated
// click listeners) ──────────────────────────────
document.addEventListener("click", (event) => {
    const mark = event.target.closest?.("mark[data-tt-highlight-id]");
    if (!mark) return;
    const id = mark.dataset.ttHighlightId;
    // A highlight spanning multiple table cells/elements is now several
    // <mark>s sharing one id (see wrapRange) — remove them all together.
    document.querySelectorAll(`mark[data-tt-highlight-id="${id}"]`).forEach(unwrap);
    removeHighlight(id);
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
    try {
        const list = await loadHighlights();
        for (const entry of list) {
            try {
                const range = findRange(entry);
                if (!range) {
                    console.warn("[Highlighter] could not restore:", entry.exact.slice(0, 40));
                    continue;
                }
                wrapRange(range, entry.id);
            } catch (err) {
                console.warn("[Highlighter] restore failed for one highlight:", err);
            }
        }
    } catch (err) {
        console.warn("[Highlighter] restore skipped:", err); // never break the page
    }
})();
