// ─────────────────────────────────────────────────────
//  FEATURE: Highlighter Settings
//  Tools-panel button opening a small panel for highlighter.js
//  (runs on every site, <all_urls>, but is configured from here since
//  this is the only page in the extension with any settings UI):
//    - one master ON/OFF switch
//    - each of the 4 highlight slots' color (a plain <input type=color>,
//      written straight to chrome.storage.local — no browser limitation
//      here, unlike the shortcut itself)
//    - each slot's CUSTOM shortcut — click "Set", press any key combo,
//      done. Recorded straight into chrome.storage.local
//      ("ttHighlightShortcuts"); highlighter.js matches raw keydown
//      events against it directly. Assigned entirely from this panel —
//      no browser settings page involved. Warns (doesn't block) if the
//      combo is one of a handful of well-known browser-reserved ones,
//      since those specifically won't fire reliably this way.
//    - each slot's chrome.commands-BOUND shortcut, read-only (fetched
//      from background.js, since chrome.commands isn't available to
//      content scripts at all) — plus a button that opens
//      chrome://extensions/shortcuts. This is the OTHER, independent
//      mechanism (see highlighter.js's file header): the only way to
//      actually claim a reserved combo like Ctrl+D is a user manually
//      binding it there (confirmed live) — nothing in THIS panel can
//      do that part, only point at where to.
//
//  A dedicated feature/panel, not a boolean row in Custom Rules
//  (custom-rules-settings.js) — this needs color pickers and live
//  shortcut lookups, neither of which fit that panel's plain toggle-list
//  shape.
// ─────────────────────────────────────────────────────

// Best-effort, not exhaustive — combos Chrome/Edge are known to reserve
// at the browser-chrome level, where a page-side keydown+preventDefault()
// (what the self-service recorder relies on) can't reliably win. Anything
// not on this list is assumed safe to record here; being wrong just means
// a slot silently doesn't fire, same as picking a reserved one deliberately —
// not a crash, just worth the warning so it's not a surprise.
const HIGHLIGHTER_RESERVED_COMBOS = [
    { ctrl: true, key: "d" }, { ctrl: true, key: "t" }, { ctrl: true, key: "n" },
    { ctrl: true, key: "w" }, { ctrl: true, key: "l" }, { ctrl: true, key: "f" },
    { ctrl: true, key: "p" }, { ctrl: true, key: "s" }, { ctrl: true, key: "r" },
    { ctrl: true, shift: true, key: "n" }, { ctrl: true, shift: true, key: "t" },
    { ctrl: true, shift: true, key: "b" }, { ctrl: true, shift: true, key: "j" },
    { ctrl: true, shift: true, key: "i" }, { ctrl: true, shift: true, key: "o" },
    { ctrl: true, shift: true, key: "delete" },
    { alt: true, key: "d" }, { alt: true, key: "e" }, { alt: true, key: "f" },
];

function isReservedCombo(desc) {
    return HIGHLIGHTER_RESERVED_COMBOS.some(r =>
        !!r.ctrl === !!desc.ctrl && !!r.shift === !!desc.shift &&
        !!r.alt === !!desc.alt && !!r.meta === !!desc.meta && r.key === desc.key);
}

function formatShortcut(desc) {
    if (!desc || !desc.key) return "";
    const parts = [];
    if (desc.ctrl) parts.push("Ctrl");
    if (desc.shift) parts.push("Shift");
    if (desc.alt) parts.push("Alt");
    if (desc.meta) parts.push("Meta");
    parts.push(desc.key.length === 1 ? desc.key.toUpperCase() : desc.key);
    return parts.join("+");
}

const HighlighterSettings = {
    _shortcuts: {}, // slot -> "Ctrl+D" etc (chrome.commands side), populated (async) each time the panel opens
    _recordingSlot: null, // slot currently waiting for a keypress, or null

    init() {
        if (!isOnScheduleForm()) return;

        Toolbar.register({
            id:      "tt-highlighter-settings",
            label:   "🖍 Highlighter",
            title:   "Turn the text highlighter on/off and set each slot's color",
            group:   "misc",
            onClick: () => this.togglePanel()
        });
    },

    buildPanel() {
        if (document.getElementById("tt-highlighter-panel")) return;

        const panel = document.createElement("div");
        panel.id = "tt-highlighter-panel";
        panel.style.cssText = `
            position: fixed !important;
            top: 52px !important;
            left: 300px !important;
            z-index: 999996 !important;
            background: #ffffff !important;
            border: 2px solid #000000 !important;
            box-shadow: 3px 3px 0px #000000 !important;
            font-family: monospace !important;
            font-size: 11px !important;
            width: 260px !important;
            display: none !important;
            box-sizing: border-box !important;
        `;

        const header = document.createElement("div");
        header.textContent = "🖍 Highlighter";
        header.style.cssText = `
            padding: 6px 10px !important;
            background: #000000 !important;
            color: #ffffff !important;
            font-weight: bold !important;
        `;

        const body = document.createElement("div");
        body.id = "tt-highlighter-body";

        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        this._panel = panel;
        this._body  = body;

        // One listener for the panel's whole lifetime, not re-added per
        // render — early-returns unless a "Set" button actually put us
        // into recording mode. Captured on the PANEL (bubbles up from
        // its own buttons), not document, so it doesn't interfere with
        // highlighter.js's own document-level keydown listener elsewhere
        // on the page.
        panel.addEventListener("keydown", (event) => this.captureRecordedKey(event));
    },

    // A bare modifier press (still deciding what to hold) is never itself
    // a usable combo — wait for the actual key. Escape cancels instead of
    // recording "Escape" as the shortcut, since that's clearly meant as
    // "never mind", not a real pick.
    captureRecordedKey(event) {
        if (!this._recordingSlot) return;
        event.preventDefault();
        event.stopPropagation();

        const key = event.key.toLowerCase();
        if (["control", "shift", "alt", "meta"].includes(key)) return;

        const slot = this._recordingSlot;
        this._recordingSlot = null;

        if (key === "escape") { this.render(); return; }

        const desc = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, key };
        this.saveShortcut(slot, desc);
    },

    async saveShortcut(slot, desc) {
        const stored = await new Promise((resolve) => chrome.storage.local.get("ttHighlightShortcuts", resolve));
        const shortcuts = { ...(stored.ttHighlightShortcuts || {}), [slot]: desc };
        chrome.storage.local.set({ ttHighlightShortcuts: shortcuts });
        this._justRecordedWarning = isReservedCombo(desc)
            ? `"${formatShortcut(desc)}" is a browser shortcut too — it may not fire reliably here. Use "Change shortcuts" below for this one instead.`
            : null;
        this.render();
    },

    async render() {
        if (!this._body) return;
        const warning = this._justRecordedWarning;
        this._justRecordedWarning = null;

        const stored = await new Promise((resolve) =>
            chrome.storage.local.get(["ttHighlightEnabled", "ttHighlightColors", "ttHighlightShortcuts"], resolve));
        const enabled       = !!stored.ttHighlightEnabled;
        const colors        = { ...HIGHLIGHT_DEFAULT_COLORS_FOR_SETTINGS, ...(stored.ttHighlightColors || {}) };
        const customCombos  = stored.ttHighlightShortcuts || {};

        this._shortcuts = await new Promise((resolve) =>
            chrome.runtime.sendMessage({ type: "GET_HIGHLIGHT_SHORTCUTS" }, (result) => {
                const map = {};
                (result || []).forEach(c => { map[c.name] = c.shortcut; });
                resolve(map);
            }));

        this._body.innerHTML = "";

        if (warning) {
            const warn = document.createElement("div");
            warn.textContent = "⚠️ " + warning;
            warn.style.cssText = "padding: 6px 10px !important; background: #fff3cd !important; color: #000000 !important; font-size: 9px !important; line-height: 1.4 !important;";
            this._body.appendChild(warn);
        }

        // Master switch
        const masterRow = document.createElement("div");
        masterRow.style.cssText = "padding: 6px 10px !important; display: flex !important; align-items: center !important; justify-content: space-between !important; border-top: 1px dashed #000000 !important;";
        const masterLabel = document.createElement("div");
        masterLabel.textContent = "Enable highlighting";
        masterLabel.style.cssText = "font-weight: bold !important;";
        const masterToggle = document.createElement("button");
        masterToggle.type = "button";
        masterToggle.textContent = enabled ? "✅ ON" : "⬜ OFF";
        masterToggle.style.cssText = `
            padding: 4px 6px !important;
            font-family: monospace !important;
            font-size: 10px !important;
            font-weight: bold !important;
            background: ${enabled ? "#d6f5d6" : "#f0f0f0"} !important;
            color: #000000 !important;
            border: 1px solid #000000 !important;
            cursor: pointer !important;
        `;
        masterToggle.addEventListener("click", () => {
            chrome.storage.local.set({ ttHighlightEnabled: !enabled });
            this.render();
        });
        masterRow.appendChild(masterLabel);
        masterRow.appendChild(masterToggle);
        this._body.appendChild(masterRow);

        // One block per slot: name+color on one line, both shortcut
        // mechanisms (custom-recorded, and chrome.commands-bound) on
        // the next — two independent things, kept visually separate
        // rather than crammed into one row.
        HIGHLIGHT_SLOTS_FOR_SETTINGS.forEach((slot, i) => {
            const block = document.createElement("div");
            block.style.cssText = "padding: 6px 10px !important; border-top: 1px dashed #000000 !important;";

            const topLine = document.createElement("div");
            topLine.style.cssText = "display: flex !important; align-items: center !important; gap: 6px !important; margin-bottom: 4px !important;";

            const label = document.createElement("div");
            label.textContent = `Highlight ${i + 1}`;
            label.style.cssText = "flex: 1 !important; font-weight: bold !important;";

            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.value = colors[slot];
            colorInput.style.cssText = "flex-shrink: 0 !important; width: 28px !important; height: 20px !important; padding: 0 !important; border: 1px solid #000000 !important; cursor: pointer !important;";
            colorInput.addEventListener("input", () => {
                colors[slot] = colorInput.value;
                chrome.storage.local.set({ ttHighlightColors: colors });
            });

            topLine.appendChild(label);
            topLine.appendChild(colorInput);

            const customLine = document.createElement("div");
            customLine.style.cssText = "display: flex !important; align-items: center !important; gap: 6px !important; font-size: 9px !important; margin-bottom: 2px !important;";
            const isRecording = this._recordingSlot === slot;
            const customText = document.createElement("div");
            customText.style.cssText = "flex: 1 !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important;";
            customText.textContent = isRecording ? "Press any key combo…" : `Shortcut: ${formatShortcut(customCombos[slot]) || "(none)"}`;
            const setBtn = document.createElement("button");
            setBtn.type = "button";
            setBtn.textContent = isRecording ? "…" : "Set";
            setBtn.title = "Click, then press the key combo you want for this slot";
            setBtn.style.cssText = `
                flex-shrink: 0 !important;
                padding: 2px 6px !important;
                font-family: monospace !important;
                font-size: 9px !important;
                background: ${isRecording ? "#fff3cd" : "#f0f0f0"} !important;
                color: #000000 !important;
                border: 1px solid #000000 !important;
                cursor: pointer !important;
            `;
            setBtn.addEventListener("click", () => {
                this._recordingSlot = isRecording ? null : slot;
                this.render();
            });
            customLine.appendChild(customText);
            customLine.appendChild(setBtn);

            const boundLine = document.createElement("div");
            boundLine.style.cssText = "font-size: 9px !important; color: #666666 !important;";
            const shortcut = this._shortcuts[slot];
            boundLine.textContent = `Browser-bound: ${shortcut || "(not set)"}`;
            boundLine.title = shortcut ? `Also bound at the browser level to ${shortcut}` : "No chrome.commands shortcut bound — see \"Change shortcuts\" below";

            block.appendChild(topLine);
            block.appendChild(customLine);
            block.appendChild(boundLine);
            this._body.appendChild(block);
        });

        // Shortcut settings link — for the rare case a "Set" button above
        // isn't enough: reserved combos like Ctrl+D need this manual step
        // instead (the only sanctioned way to actually claim one — the
        // browser only lets it override its own action once assigned
        // here, confirmed live).
        const shortcutsRow = document.createElement("div");
        shortcutsRow.style.cssText = "padding: 8px 10px !important; border-top: 1px dashed #000000 !important;";
        const shortcutsBtn = document.createElement("button");
        shortcutsBtn.type = "button";
        shortcutsBtn.textContent = "🔧 Browser shortcut settings (for reserved keys)";
        shortcutsBtn.title = "Opens the browser's own extension-shortcuts page — only needed for a combo like Ctrl+D that \"Set\" above warns about";
        shortcutsBtn.style.cssText = `
            width: 100% !important;
            padding: 5px !important;
            font-family: monospace !important;
            font-size: 10px !important;
            background: #f0f0f0 !important;
            color: #000000 !important;
            border: 1px solid #000000 !important;
            cursor: pointer !important;
        `;
        shortcutsBtn.addEventListener("click", () => {
            chrome.runtime.sendMessage({ type: "OPEN_SHORTCUTS_PAGE" });
        });
        shortcutsRow.appendChild(shortcutsBtn);
        this._body.appendChild(shortcutsRow);
    },

    togglePanel() {
        this.buildPanel();
        const isHidden = this._panel.style.display === "none";
        if (isHidden) this.render();
        this._panel.style.display = isHidden ? "block" : "none";
    },

    handle(_event) {},
    handleBlur(_event) {}
};

// Kept in sync with highlighter.js's own HIGHLIGHT_SLOTS/DEFAULT_COLORS
// by hand (this file never runs in the same execution context as
// highlighter.js — different content-script match blocks — so they
// can't literally share the const; both must be updated together if
// slots are ever added).
const HIGHLIGHT_SLOTS_FOR_SETTINGS = ["highlight-1", "highlight-2", "highlight-3", "highlight-4"];
const HIGHLIGHT_DEFAULT_COLORS_FOR_SETTINGS = {
    "highlight-1": "#ffff00",
    "highlight-2": "#90ee90",
    "highlight-3": "#ff8fc7",
    "highlight-4": "#87ceeb",
};
