// ─────────────────────────────────────────────────────
//  FEATURE: Notes Sidebar
//  Collapsible panel pinned to the left edge, mirroring the
//  real notes textarea — bigger, out of the way of the form,
//  and always visible while scrolling. Two-way: typing in
//  either one updates the other.
// ─────────────────────────────────────────────────────
const NotesSidebar = {
    mirroring: false, // re-entrancy guard, same idea as main.js's `syncing` — stops our own write from bouncing back into an update loop

    init() {
        const notesField = document.querySelector('textarea[name="notes"]');
        if (!notesField) return; // no notes field on this page, nothing to do

        this.notesField = notesField;
        this.collapsed = localStorage.getItem("tt-notes-sidebar-collapsed") === "1";

        this.buildPanel();
        this.syncFromField();

        // Keep the panel in sync if the real field changes from
        // somewhere else — e.g. NotesDateReplacement's date swap on
        // load, or Tradetech's own scripts.
        notesField.addEventListener("input", () => this.syncFromField());
    },

    // Same visual language as the warning/info banners in banner.js
    // (yellow BANNER_STYLE) — this box is meant to read as "one of our
    // banners", just editable, not as a separate black-header toolbar
    // panel like Toolbar's.
    buildPanel() {
        const panel = document.createElement("div");
        panel.id = "tt-notes-sidebar";
        panel.style.cssText = `
            position: fixed !important;
            top: 52px !important;
            left: 16px !important;
            z-index: 999998 !important;
            background: #fcff9e !important;
            color: #000000 !important;
            border: 2px solid #000000 !important;
            border-radius: 0px !important;
            box-shadow: 3px 3px 0px #000000 !important;
            font-family: monospace !important;
            font-size: 11px !important;
            letter-spacing: 0.5px !important;
            width: 260px !important;
            max-height: 300px !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
            opacity: 0.95 !important;
        `;

        const header = document.createElement("div");
        header.id = "tt-notes-sidebar-header";
        header.style.cssText = `
            padding: 10px 16px 6px !important;
            cursor: pointer !important;
            user-select: none !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            font-weight: bold !important;
        `;
        header.innerHTML = `<span>📝 Notes</span><span id="tt-notes-sidebar-arrow">${this.collapsed ? "▸" : "▾"}</span>`;
        header.addEventListener("click", () => this.toggleCollapsed());

        const textarea = document.createElement("textarea");
        textarea.id = "tt-notes-sidebar-textarea";
        textarea.style.cssText = `
            display: ${this.collapsed ? "none" : "block"} !important;
            width: 100% !important;
            height: 220px !important;
            max-height: 220px !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            border: none !important;
            border-top: 1px dashed #000000 !important;
            background: transparent !important;
            padding: 8px 16px 12px !important;
            font-family: monospace !important;
            font-size: 11px !important;
            letter-spacing: 0.5px !important;
            line-height: 1.6 !important;
            color: #000000 !important;
            overflow-y: auto !important;
            resize: none !important;
        `;
        textarea.addEventListener("input", (e) => {
            if (this.mirroring) return;
            this.mirroring = true;
            setFieldValue(this.notesField, e.target.value);
            this.mirroring = false;
        });

        panel.appendChild(header);
        panel.appendChild(textarea);
        document.body.appendChild(panel);

        this.textarea = textarea;
    },

    toggleCollapsed() {
        this.collapsed = !this.collapsed;
        localStorage.setItem("tt-notes-sidebar-collapsed", this.collapsed ? "1" : "0");
        this.textarea.style.display = this.collapsed ? "none" : "block";
        document.getElementById("tt-notes-sidebar-arrow").textContent = this.collapsed ? "▸" : "▾";
    },

    syncFromField() {
        if (this.mirroring) return;
        this.mirroring = true;
        this.textarea.value = this.notesField.value;
        this.mirroring = false;
    },

    // No auto-trigger needed via the shared change listener — this
    // feature wires its own listeners directly on both fields above.
    handle(_event) {},
    handleBlur(_event) {}
};
