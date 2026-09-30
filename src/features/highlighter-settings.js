// ─────────────────────────────────────────────────────
//  FEATURE: Highlighter Settings
//  Tools-panel button opening a small panel for highlighter.js
//  (runs on every site, <all_urls>, but is configured from here since
//  this is the only page in the extension with any settings UI):
//    - one master ON/OFF switch
//    - each of the 4 highlight slots' color (a plain <input type=color>,
//      written straight to chrome.storage.local — no browser limitation
//      here, unlike the shortcut itself)
//    - each slot's CUSTOM shortcut — Ctrl/Shift/Alt checkboxes + a key
//      field (a native <input list> — pick a suggestion or just type
//      any key), then Save. Stored straight into chrome.storage.local
//      ("ttHighlightShortcuts"); highlighter.js matches raw keydown
//      events against it directly. Assigned entirely from this panel —
//      no browser settings page involved, and no live key-press capture
//      either (that approach got stuck forever on any combo the browser
//      fully swallows before page JS ever sees it, e.g. Ctrl+T/N/W —
//      picking from a list/typing a key sidesteps that: building the
//      combo never involves the browser actually acting on it). Warns
//      (doesn't block) if the combo is one of a handful of well-known
//      browser-reserved ones, since those specifically won't fire
//      reliably once actually used, regardless of how they were set.
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
// (what highlighter.js's own matching relies on, once a combo is actually
// USED) can't reliably win. Anything not on this list is assumed safe to
// pick here; being wrong just means a slot silently doesn't fire, same as
// picking a reserved one deliberately — not a crash, just worth the
// warning so it's not a surprise.
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

// Suggestions for the key <input list=...> datalist — not a restriction,
// just the common ones so the field isn't blank with nothing to pick
// from. Typing any other single key (a symbol, etc.) works too.
const HIGHLIGHTER_KEY_OPTIONS = [
    ..."abcdefghijklmnopqrstuvwxyz0123456789".split(""),
    ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
];

const HighlighterSettings = {
    _shortcuts: {}, // slot -> "Ctrl+D" etc (chrome.commands side), populated (async) each time the panel opens

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
    },

    // Reads whatever's currently in each slot's checkboxes/key field (not
    // necessarily what's saved yet) and writes all 4 in one go — matches
    // "set a key, or all 4, then press Save" rather than a per-row save.
    // Takes effect immediately in every open tab (chrome.storage.onChanged,
    // no reload needed) — a slot whose key field is left blank keeps
    // whatever was already saved for it, so setting just one slot doesn't
    // wipe the other three.
    //
    // Does NOT also bind these at the browser level — there is no API for
    // that. chrome.commands has exactly one method, getAll() (read-only);
    // confirmed directly against the official docs — no update()/set(),
    // and chrome://extensions/shortcuts is a privileged page no content
    // script can be injected into or write to. The only sanctioned way a
    // shortcut becomes a real browser-level binding is the user typing it
    // into that page themselves. Best this can do: show exactly what was
    // just picked so that's a copy job, not a lookup — see the banner
    // built below and the "Browser shortcut settings" button underneath.
    saveAllShortcuts() {
        const stored = {};
        const lines = [];

        HIGHLIGHT_SLOTS_FOR_SETTINGS.forEach((slot, i) => {
            const inputs = this._slotInputs?.[slot];
            if (!inputs) return;
            const key = inputs.keyInput.value.trim().toLowerCase();
            if (!key) return; // left blank — don't touch this slot's saved combo

            const desc = { ctrl: inputs.ctrlCb.checked, shift: inputs.shiftCb.checked, alt: inputs.altCb.checked, key };
            stored[slot] = desc;
            const reserved = isReservedCombo(desc);
            lines.push(`${reserved ? "⚠ " : ""}Highlight ${i + 1} → ${formatShortcut(desc)}${reserved ? " (browser-reserved)" : ""}`);
        });

        if (Object.keys(stored).length === 0) return; // nothing entered, nothing to save

        chrome.storage.local.get("ttHighlightShortcuts", (existing) => {
            const shortcuts = { ...(existing.ttHighlightShortcuts || {}), ...stored };
            chrome.storage.local.set({ ttHighlightShortcuts: shortcuts });
            this._saveSummary = lines;
            this.render();
        });
    },

    async render() {
        if (!this._body) return;
        const saveSummary = this._saveSummary;
        this._saveSummary = null;
        this._slotInputs = {};

        const stored = await new Promise((resolve) =>
            chrome.storage.local.get(["ttHighlightEnabled", "ttHighlightColors", "ttHighlightShortcuts"], resolve));
        const enabled       = stored.ttHighlightEnabled !== false; // default ON, matches highlighter.js
        const colors        = { ...HIGHLIGHT_DEFAULT_COLORS_FOR_SETTINGS, ...(stored.ttHighlightColors || {}) };
        const customCombos  = stored.ttHighlightShortcuts || {};

        this._shortcuts = await new Promise((resolve) =>
            chrome.runtime.sendMessage({ type: "GET_HIGHLIGHT_SHORTCUTS" }, (result) => {
                const map = {};
                (result || []).forEach(c => { map[c.name] = c.shortcut; });
                resolve(map);
            }));

        this._body.innerHTML = "";

        if (saveSummary && saveSummary.length) {
            const box = document.createElement("div");
            box.style.cssText = "padding: 6px 10px !important; background: #fff3cd !important; color: #000000 !important; font-size: 9px !important; line-height: 1.5 !important;";
            const heading = document.createElement("div");
            heading.textContent = "Saved here. To ALSO make these real browser shortcuts, type them into \"Browser shortcut settings\" below:";
            heading.style.cssText = "font-weight: bold !important; margin-bottom: 3px !important;";
            box.appendChild(heading);
            saveSummary.forEach((line) => {
                const row = document.createElement("div");
                row.textContent = line;
                box.appendChild(row);
            });
            this._body.appendChild(box);
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

            const combo = customCombos[slot] || {};
            const customLine = document.createElement("div");
            customLine.style.cssText = "display: flex !important; align-items: center !important; gap: 4px !important; font-size: 9px !important; margin-bottom: 2px !important; flex-wrap: wrap !important;";

            const mkCheckbox = (labelText, checked) => {
                const wrap = document.createElement("label");
                wrap.style.cssText = "display: flex !important; align-items: center !important; gap: 2px !important; cursor: pointer !important;";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = !!checked;
                wrap.appendChild(cb);
                wrap.appendChild(document.createTextNode(labelText));
                return { wrap, cb };
            };
            const ctrlBox  = mkCheckbox("Ctrl", combo.ctrl);
            const shiftBox = mkCheckbox("Shift", combo.shift);
            const altBox   = mkCheckbox("Alt", combo.alt);

            // A native <input list> — pick a suggestion from the datalist
            // or just type any other key directly, no fixed enum.
            const keyInput = document.createElement("input");
            keyInput.type = "text";
            keyInput.setAttribute("list", "tt-highlighter-key-options");
            keyInput.placeholder = "key";
            keyInput.value = combo.key || "";
            keyInput.style.cssText = "width: 44px !important; font-family: monospace !important; font-size: 9px !important; padding: 1px 3px !important; border: 1px solid #000000 !important;";

            this._slotInputs[slot] = { ctrlCb: ctrlBox.cb, shiftCb: shiftBox.cb, altCb: altBox.cb, keyInput };

            customLine.appendChild(ctrlBox.wrap);
            customLine.appendChild(shiftBox.wrap);
            customLine.appendChild(altBox.wrap);
            customLine.appendChild(keyInput);

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

        // Shared datalist for every slot's key <input list>.
        const datalist = document.createElement("datalist");
        datalist.id = "tt-highlighter-key-options";
        HIGHLIGHTER_KEY_OPTIONS.forEach((k) => {
            const opt = document.createElement("option");
            opt.value = k;
            datalist.appendChild(opt);
        });
        this._body.appendChild(datalist);

        // One shared Save for all 4 slots at once — set a key for one or
        // all four, click this once, done. Applies immediately in every
        // open tab (chrome.storage.onChanged), no reload needed.
        const saveRow = document.createElement("div");
        saveRow.style.cssText = "padding: 8px 10px !important; border-top: 1px dashed #000000 !important;";
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.textContent = "💾 Save Shortcuts";
        saveBtn.style.cssText = `
            width: 100% !important;
            padding: 5px !important;
            font-family: monospace !important;
            font-size: 10px !important;
            font-weight: bold !important;
            background: #d6f5d6 !important;
            color: #000000 !important;
            border: 1px solid #000000 !important;
            cursor: pointer !important;
        `;
        saveBtn.addEventListener("click", () => this.saveAllShortcuts());
        saveRow.appendChild(saveBtn);
        this._body.appendChild(saveRow);

        // Shortcut settings link — for the rare case the field above isn't
        // enough: reserved combos like Ctrl+D need this manual step
        // instead (the only sanctioned way to actually claim one — the
        // browser only lets it override its own action once assigned
        // here, confirmed live).
        const shortcutsRow = document.createElement("div");
        shortcutsRow.style.cssText = "padding: 8px 10px !important; border-top: 1px dashed #000000 !important;";
        const shortcutsBtn = document.createElement("button");
        shortcutsBtn.type = "button";
        shortcutsBtn.textContent = "🔧 Browser shortcut settings (for reserved keys)";
        shortcutsBtn.title = "Opens the browser's own extension-shortcuts page — only needed for a combo like Ctrl+D that the picker above warns about";
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
