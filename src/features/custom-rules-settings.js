// ─────────────────────────────────────────────────────
//  FEATURE: Custom Rules Settings
//  Tools-panel button opening a small panel that lists every rule
//  in CustomRules.RULES (src/utils/custom-rules.js) as an ON/OFF
//  toggle, so a real, named exception to a check (e.g. "duplicates
//  are fine when the voyage increment is negative") doesn't need
//  code edited to turn on/off. New rules just need one entry added
//  to RULES — this panel renders whatever's there, no changes
//  needed here.
//
//  Each row shows just the label + toggle by default — an
//  expand arrow reveals the fuller description in place, so the
//  panel stays short with several rules in it instead of turning
//  into a wall of text.
// ─────────────────────────────────────────────────────
const CustomRulesSettings = {
    _expanded: new Set(), // rule ids currently showing their description

    init() {
        if (!isOnScheduleForm()) return;

        Toolbar.register({
            id:      "tt-custom-rules-settings",
            label:   "⚙️ Custom Rules",
            title:   "Turn specific custom-rule exceptions on or off",
            group:   "misc",
            onClick: () => this.togglePanel()
        });
    },

    buildPanel() {
        if (document.getElementById("tt-custom-rules-panel")) return;

        const panel = document.createElement("div");
        panel.id = "tt-custom-rules-panel";
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
        header.textContent = "⚙️ Custom Rules";
        header.style.cssText = `
            padding: 6px 10px !important;
            background: #000000 !important;
            color: #ffffff !important;
            font-weight: bold !important;
        `;

        const list = document.createElement("div");
        list.id = "tt-custom-rules-list";

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

        CustomRules.RULES.forEach(rule => {
            const row = document.createElement("div");
            row.style.cssText = "border-top: 1px dashed #000000 !important;";

            // Short line: expand arrow + label + ON/OFF, nothing else —
            // this is the only thing visible until the arrow is clicked.
            const line = document.createElement("div");
            line.style.cssText = `
                padding: 6px 10px !important;
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
            `;

            const expandBtn = document.createElement("button");
            expandBtn.type = "button";
            expandBtn.textContent = this._expanded.has(rule.id) ? "▾" : "▸";
            expandBtn.title = "Show/hide details";
            expandBtn.style.cssText = `
                flex-shrink: 0 !important;
                background: transparent !important;
                border: none !important;
                cursor: pointer !important;
                font-size: 10px !important;
                padding: 0 !important;
            `;
            expandBtn.addEventListener("click", () => {
                if (this._expanded.has(rule.id)) this._expanded.delete(rule.id);
                else this._expanded.add(rule.id);
                this.renderRules();
            });

            const label = document.createElement("div");
            label.textContent = rule.label;
            label.style.cssText = "flex: 1 !important; min-width: 0 !important; font-weight: bold !important;";

            const enabled = CustomRules.isEnabled(rule.id);
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
                CustomRules.setEnabled(rule.id, !enabled);
                this.renderRules();
                // Re-run whatever's currently on the page that might care —
                // simplest reliable way is to just re-run the two known
                // consumers directly.
                if (typeof DuplicateVesselCheck !== "undefined") DuplicateVesselCheck.check();
                if (typeof LiveCheck !== "undefined") LiveCheck.compareAll();
            });

            line.appendChild(expandBtn);
            line.appendChild(label);
            line.appendChild(toggle);
            row.appendChild(line);

            if (this._expanded.has(rule.id)) {
                const desc = document.createElement("div");
                desc.textContent = rule.description;
                desc.style.cssText = `
                    padding: 0 10px 8px 24px !important;
                    color: #666666 !important;
                    font-size: 9px !important;
                    line-height: 1.4 !important;
                `;
                row.appendChild(desc);
            }

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
