// ─────────────────────────────────────────────────────
//  FEATURE: Validation Rules Settings
//  Tools-panel button opening a small panel that lists every rule
//  in ValidationRules.RULES (src/utils/validation-rules.js) as an
//  ON/OFF toggle with its label and description, so a real,
//  named exception to a check (e.g. "duplicates are fine when the
//  voyage increment is negative") doesn't need code edited to turn
//  on/off. New rules just need one entry added to RULES — this
//  panel renders whatever's there, no changes needed here.
// ─────────────────────────────────────────────────────
const ValidationRulesSettings = {
    init() {
        if (!isOnScheduleForm()) return;

        Toolbar.register({
            id:      "tt-validation-rules-settings",
            label:   "⚙️ Validation Rules",
            title:   "Turn specific validation-rule exceptions on or off",
            group:   "misc",
            onClick: () => this.togglePanel()
        });
    },

    buildPanel() {
        if (document.getElementById("tt-validation-rules-panel")) return;

        const panel = document.createElement("div");
        panel.id = "tt-validation-rules-panel";
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
            width: 280px !important;
            display: none !important;
            box-sizing: border-box !important;
        `;

        const header = document.createElement("div");
        header.textContent = "⚙️ Validation Rules";
        header.style.cssText = `
            padding: 6px 10px !important;
            background: #000000 !important;
            color: #ffffff !important;
            font-weight: bold !important;
        `;

        const list = document.createElement("div");
        list.id = "tt-validation-rules-list";

        panel.appendChild(header);
        panel.appendChild(list);
        document.body.appendChild(panel);

        this._panel = panel;
        this._list  = list;

        this.renderRules();
    },

    renderRules() {
        if (!this._list) return;
        this._list.innerHTML = "";

        ValidationRules.RULES.forEach(rule => {
            const row = document.createElement("div");
            row.style.cssText = `
                padding: 8px 10px !important;
                border-top: 1px dashed #000000 !important;
                display: flex !important;
                align-items: flex-start !important;
                gap: 8px !important;
            `;

            const text = document.createElement("div");
            text.style.cssText = "flex: 1 !important; min-width: 0 !important;";

            const label = document.createElement("div");
            label.textContent = rule.label;
            label.style.cssText = "font-weight: bold !important; margin-bottom: 2px !important;";

            const desc = document.createElement("div");
            desc.textContent = rule.description;
            desc.style.cssText = "color: #666666 !important; font-size: 9px !important; line-height: 1.4 !important;";

            text.appendChild(label);
            text.appendChild(desc);

            const enabled = ValidationRules.isEnabled(rule.id);
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.textContent = enabled ? "✅ ON" : "⬜ OFF";
            toggle.title = "Click to toggle";
            toggle.style.cssText = `
                flex-shrink: 0 !important;
                padding: 4px 6px !important;
                font-family: monospace !important;
                font-size: 10px !important;
                font-weight: bold !important;
                background: ${enabled ? "#d6f5d6" : "#f0f0f0"} !important;
                color: #000000 !important;
                border: 1px solid #000000 !important;
                cursor: pointer !important;
            `;
            toggle.addEventListener("click", () => {
                ValidationRules.setEnabled(rule.id, !enabled);
                this.renderRules();
                // Re-run whatever's currently on the page that might care —
                // simplest reliable way is to just re-run every feature's
                // handle-independent recheck via the two known consumers.
                if (typeof DuplicateVesselCheck !== "undefined") DuplicateVesselCheck.check();
                if (typeof LiveCheck !== "undefined") LiveCheck.compareAll();
            });

            row.appendChild(text);
            row.appendChild(toggle);
            this._list.appendChild(row);
        });
    },

    togglePanel() {
        this.buildPanel();
        const isHidden = this._panel.style.display === "none";
        if (isHidden) this.renderRules();
        this._panel.style.display = isHidden ? "block" : "none";
    },

    handle(_event) {},
    handleBlur(_event) {}
};
