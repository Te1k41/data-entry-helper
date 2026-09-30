// ─────────────────────────────────────────────────────
//  FEATURE: Highlighter Settings
//  Tools-panel button opening a small panel for highlighter.js
//  (runs on every site, <all_urls>, but is configured from here since
//  this is the only page in the extension with any settings UI):
//    - one master ON/OFF switch
//    - each of the 4 highlight slots' color (a plain <input type=color>,
//      written straight to chrome.storage.local — no browser limitation
//      here, unlike the shortcut itself)
//    - each slot's CURRENTLY bound keyboard shortcut, read-only (fetched
//      from background.js, since chrome.commands isn't available to
//      content scripts at all) — plus a button that opens
//      chrome://extensions/shortcuts, since that manual assignment step
//      is the only way a browser lets an extension actually claim a
//      normally-reserved combo like Ctrl+D (confirmed live) — nothing
//      here can assign a shortcut for the user, only point at where to.
//
//  A dedicated feature/panel, not a boolean row in Custom Rules
//  (custom-rules-settings.js) — this needs color pickers and live
//  shortcut lookups, neither of which fit that panel's plain toggle-list
//  shape.
// ─────────────────────────────────────────────────────
const HighlighterSettings = {
    _shortcuts: {}, // slot -> "Ctrl+D" etc, populated (async) each time the panel opens

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

    async render() {
        if (!this._body) return;

        const stored = await new Promise((resolve) =>
            chrome.storage.local.get(["ttHighlightEnabled", "ttHighlightColors"], resolve));
        const enabled = !!stored.ttHighlightEnabled;
        const colors  = { ...HIGHLIGHT_DEFAULT_COLORS_FOR_SETTINGS, ...(stored.ttHighlightColors || {}) };

        this._shortcuts = await new Promise((resolve) =>
            chrome.runtime.sendMessage({ type: "GET_HIGHLIGHT_SHORTCUTS" }, (result) => {
                const map = {};
                (result || []).forEach(c => { map[c.name] = c.shortcut; });
                resolve(map);
            }));

        this._body.innerHTML = "";

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

        // One row per slot: label + current shortcut + color swatch
        HIGHLIGHT_SLOTS_FOR_SETTINGS.forEach((slot, i) => {
            const row = document.createElement("div");
            row.style.cssText = "padding: 6px 10px !important; display: flex !important; align-items: center !important; gap: 6px !important; border-top: 1px dashed #000000 !important;";

            const label = document.createElement("div");
            const shortcut = this._shortcuts[slot];
            label.textContent = `Highlight ${i + 1}: ${shortcut || "(not set)"}`;
            label.style.cssText = "flex: 1 !important; min-width: 0 !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;";
            label.title = shortcut ? `Bound to ${shortcut}` : "No shortcut assigned yet — use \"Change shortcuts\" below";

            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.value = colors[slot];
            colorInput.style.cssText = "flex-shrink: 0 !important; width: 28px !important; height: 20px !important; padding: 0 !important; border: 1px solid #000000 !important; cursor: pointer !important;";
            colorInput.addEventListener("input", () => {
                colors[slot] = colorInput.value;
                chrome.storage.local.set({ ttHighlightColors: colors });
            });

            row.appendChild(label);
            row.appendChild(colorInput);
            this._body.appendChild(row);
        });

        // Shortcut settings link — the only sanctioned way to actually
        // assign/override a browser shortcut is the user doing it here
        // themselves (confirmed: reassigning even a reserved combo like
        // Ctrl+D there does take priority over the browser's own action).
        const shortcutsRow = document.createElement("div");
        shortcutsRow.style.cssText = "padding: 8px 10px !important; border-top: 1px dashed #000000 !important;";
        const shortcutsBtn = document.createElement("button");
        shortcutsBtn.type = "button";
        shortcutsBtn.textContent = "🔧 Change shortcuts";
        shortcutsBtn.title = "Opens the browser's own extension-shortcuts page";
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
