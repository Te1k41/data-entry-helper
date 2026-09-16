// ─────────────────────────────────────────────────────
//  FEATURE: AWR (All Water Route) Suggestion
//  Suggests AWR = Yes when the schedule calls a US port (West
//  or East coast) AND transits the Panama Canal — a port_name
//  of exactly "PANAMA CANAL, PANAMA", OR a port_code in
//  PANAMA_CANAL_CODES below (some schedules record the transit
//  under one of those codes with a differently-worded name) —
//  both conditions required together
//  — OR the service code is one of ALWAYS_AWR_SERVICES below,
//  which are always AWR regardless of their ports (a standing
//  business rule per service, editable from the Tools panel's
//  "⚙️ AWR Services" button, not something derived from the
//  port list).
//
//  Deliberately does NOT auto-click the radio — this used to,
//  but a schedule's AWR status is a real compliance judgment
//  call, not something safe to silently flip without a human
//  looking at it. Instead shows a suggestion (via the shared
//  warning registry, so it combines cleanly with any other
//  active warning) with an inline "Apply" button — one click
//  still applies it, but a human always makes that click.
// ─────────────────────────────────────────────────────
const AwrFlag = {
    PANAMA_CANAL_NAME: "PANAMA CANAL, PANAMA",
    // Alternate port codes some schedules use for the same Panama Canal
    // transit instead of (or alongside) the exact port_name above. Add
    // another one by just adding its code here.
    PANAMA_CANAL_CODES: ["PAN2", "PCNB"],

    AWR_SERVICES_STORAGE_KEY: "tt-awr-always-services",
    DEFAULT_ALWAYS_AWR_SERVICES: ["ECUMED"],

    // Service codes that are ALWAYS AWR = Yes, regardless of their
    // ports. Populated from localStorage at init() — edit the list via
    // the Tools panel's "⚙️ AWR Services" button, not by hand-editing
    // this array. Case-insensitive; a directional suffix on the real
    // service code (e.g. "ECUMED-N", same suffix convention
    // voyage-direction.js reads off this same field) still matches
    // the bare name in the list.
    ALWAYS_AWR_SERVICES: [],

    APPLY_BUTTON_STYLE: "margin-left:6px;font-size:9px;padding:0 3px;cursor:pointer;background:#fff;color:#000;border:1px solid #000;border-radius:0;",

    init() {
        this.ALWAYS_AWR_SERVICES = this.loadAlwaysAwrServices();

        // Delegated (not attached to the button itself) since banner.js
        // rebuilds the warning banner's DOM on every render — same
        // pattern live-check.js's dismiss button already uses.
        document.addEventListener("click", (event) => this.handleApplyClick(event));

        if (isOnScheduleForm()) {
            Toolbar.register({
                id:      "tt-awr-services-settings",
                label:   "⚙️ AWR Services",
                title:   "Manage which service codes are always AWR = Yes",
                group:   "misc",
                onClick: () => this.toggleServicesPanel()
            });
        }

        this.run();
    },

    // ── Always-AWR service list (persisted, editable) ──────────────

    loadAlwaysAwrServices() {
        try {
            const raw = localStorage.getItem(this.AWR_SERVICES_STORAGE_KEY);
            if (!raw) return [...this.DEFAULT_ALWAYS_AWR_SERVICES];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length ? parsed : [...this.DEFAULT_ALWAYS_AWR_SERVICES];
        } catch {
            return [...this.DEFAULT_ALWAYS_AWR_SERVICES];
        }
    },

    saveAlwaysAwrServices(list) {
        this.ALWAYS_AWR_SERVICES = list;
        localStorage.setItem(this.AWR_SERVICES_STORAGE_KEY, JSON.stringify(list));
    },

    isAlwaysAwrService() {
        const serviceField = document.querySelector('input[name="service"]');
        if (!serviceField) return false;

        const code = serviceField.value.trim().toUpperCase().replace(/-[NSEW]$/, "");
        return this.ALWAYS_AWR_SERVICES.includes(code);
    },

    buildServicesPanel() {
        if (document.getElementById("tt-awr-services-panel")) return;

        const panel = document.createElement("div");
        panel.id = "tt-awr-services-panel";
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
            width: 220px !important;
            display: none !important;
            box-sizing: border-box !important;
        `;

        const header = document.createElement("div");
        header.textContent = "⚙️ Always-AWR Services";
        header.style.cssText = `
            padding: 6px 10px !important;
            background: #000000 !important;
            color: #ffffff !important;
            font-weight: bold !important;
        `;

        const help = document.createElement("div");
        help.textContent = "One service code per line — always AWR = Yes.";
        help.style.cssText = `
            padding: 6px 10px 0 !important;
            color: #666666 !important;
            font-size: 9px !important;
        `;

        const textarea = document.createElement("textarea");
        textarea.id = "tt-awr-services-textarea";
        textarea.style.cssText = `
            display: block !important;
            width: 100% !important;
            height: 90px !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            border: none !important;
            border-top: 1px dashed #000000 !important;
            padding: 8px 10px !important;
            font-family: monospace !important;
            font-size: 11px !important;
            resize: none !important;
        `;

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.textContent = "💾 Save";
        saveBtn.style.cssText = `
            display: block !important;
            width: 100% !important;
            padding: 6px !important;
            font-family: monospace !important;
            font-size: 11px !important;
            font-weight: bold !important;
            background: #ffffff !important;
            border: none !important;
            border-top: 1px solid #000000 !important;
            cursor: pointer !important;
        `;
        saveBtn.addEventListener("click", () => {
            // Strip a trailing directional suffix here too (isAlwaysAwrService()
            // already strips it off the CURRENT record's own service code before
            // comparing) — so typing any one direction, e.g. "ECUMED-N", still
            // ends up stored as the bare "ECUMED" and covers all four
            // directions, not just the one literally typed.
            const list = [...new Set(
                textarea.value.split("\n")
                    .map(s => s.trim().toUpperCase().replace(/-[NSEW]$/, ""))
                    .filter(Boolean)
            )];
            this.saveAlwaysAwrServices(list);
            showTemporaryBanner({ title: "⚙️ AWR services saved", message: list.join(", ") || "(none)" });
            this.run(); // re-check the current record against the new list immediately
        });

        panel.appendChild(header);
        panel.appendChild(help);
        panel.appendChild(textarea);
        panel.appendChild(saveBtn);
        document.body.appendChild(panel);

        this._servicesPanel    = panel;
        this._servicesTextarea = textarea;
    },

    toggleServicesPanel() {
        this.buildServicesPanel();
        const isHidden = this._servicesPanel.style.display === "none";
        if (isHidden) this._servicesTextarea.value = this.ALWAYS_AWR_SERVICES.join("\n");
        this._servicesPanel.style.display = isHidden ? "block" : "none";
    },

    // ── Qualification ───────────────────────────────────────────────

    getPortNameFields() {
        return Array.from(document.querySelectorAll('input[type="text"][name^="SP"][name$="_port_name"]'));
    },

    getPortCodeFields() {
        return Array.from(document.querySelectorAll('input[type="text"][name^="SP"][name$="_port_code"]'));
    },

    hasPanamaCanal() {
        const byName = this.getPortNameFields().some(f => f.value.trim().toUpperCase() === this.PANAMA_CANAL_NAME);
        const byCode = this.getPortCodeFields().some(f => this.PANAMA_CANAL_CODES.includes(f.value.trim().toUpperCase()));
        return byName || byCode;
    },

    // "USA" must be one of the last 3 whitespace-separated tokens (each
    // stripped of punctuation before comparing) — tolerates real-world
    // trailing formatting like "(USA)" or "USA," without false-matching
    // "USA" merely appearing inside an unrelated word/port name.
    hasUSPort() {
        return this.getPortNameFields().some(f => {
            const tokens = f.value.trim().toUpperCase().split(/\s+/).slice(-3);
            return tokens.some(t => t.replace(/[^A-Z]/g, "") === "USA");
        });
    },

    // The one qualification check every caller uses, so none of them
    // can drift out of sync by recomputing the formula separately.
    isQualified() {
        return this.isAlwaysAwrService() || (this.hasUSPort() && this.hasPanamaCanal());
    },

    getRadios() {
        return {
            yes: document.querySelector('input[name="allWater"][value="Yes"]'),
            no:  document.querySelector('input[name="allWater"][value="No"]')
        };
    },

    // Same red convention live-check.js's MISMATCH_HIGHLIGHT uses for a
    // field that needs attention — applied to whichever radio the
    // suggestion says to click, so the banner's "Apply" isn't the only
    // cue pointing at it.
    MISMATCH_HIGHLIGHT: { outline: "2px solid #b00020", backgroundColor: "#ffd6d6" },

    applyMismatchHighlight(field) {
        field.style.outline = this.MISMATCH_HIGHLIGHT.outline;
        field.style.backgroundColor = this.MISMATCH_HIGHLIGHT.backgroundColor;
    },

    clearMismatchHighlight(field) {
        field.style.outline = "";
        field.style.backgroundColor = "";
    },

    // Records the outcome of the most recent run() on the document
    // itself (not just in memory) so an outside reader could pick up
    // "does this record's AWR disagree with the suggestion" without
    // its own copy of the qualifies logic. `corrected` is always false
    // now — nothing here applies a fix by itself anymore, a human (or
    // whatever reads this) has to actually click Apply.
    reportAuditResult(qualifies, checked) {
        document.documentElement.dataset.ttAwrAudit = JSON.stringify({ qualifies, checked, corrected: false });
    },

    // ── Suggestion (no auto-click) ──────────────────────────────────

    run() {
        const { yes, no } = this.getRadios();
        if (!yes || !no) return; // not a page with the AWR radios

        const qualifies = this.isQualified();
        const checked = yes.checked ? "Yes" : (no.checked ? "No" : null);

        this.reportAuditResult(qualifies, checked === "Yes");

        const matches = (qualifies && checked === "Yes") || (!qualifies && checked === "No");
        if (matches) {
            setWarning("awr-suggestion", null);
            this.clearMismatchHighlight(yes);
            this.clearMismatchHighlight(no);
            return;
        }

        const suggested = qualifies ? "Yes" : "No";
        const reason = qualifies
            ? "US port call and Panama Canal transit detected"
            : "Not both a US port call and Panama Canal transit";

        this.clearMismatchHighlight(qualifies ? no : yes);
        this.applyMismatchHighlight(qualifies ? yes : no);

        setWarning("awr-suggestion", {
            title:   "💡 AWR suggestion",
            message: `${reason} — suggest AWR: ${suggested}.` +
                `<button data-tt-awr-apply="${suggested}" style="${this.APPLY_BUTTON_STYLE}">Apply</button>`
        });
    },

    handleApplyClick(event) {
        const button = event.target.closest("[data-tt-awr-apply]");
        if (!button) return;

        const { yes, no } = this.getRadios();
        const target = button.dataset.ttAwrApply === "Yes" ? yes : no;
        if (!target) return;

        target.click(); // real click — fires change, matches Tradetech's own OS_allWater sync
        showTemporaryBanner({ title: "✅ AWR updated", message: `Set to ${button.dataset.ttAwrApply}` });
    },

    handle(event) {
        const { name } = event.target;
        if (!name) return;

        if (name === "allWater") {
            this.run(); // just refreshes the suggestion (clears it if this now matches)
            return;
        }

        if (/^SP\d+_port_name$/.test(name) || /^SP\d+_port_code$/.test(name)) {
            this.run();

            const codeMatch = name.match(/^SP(\d+)_port_code$/);
            if (codeMatch) this.waitForNameThenRescan(codeMatch[1]);
        }
    },

    // Same polling workaround as port-highlighting.js's identically-named
    // method: Tradetech auto-fills SPnnn_port_name asynchronously after a
    // port_code change, by setting .value directly (no "change" event),
    // so poll briefly until it's populated, then re-scan.
    waitForNameThenRescan(row) {
        clearInterval(this._recheckTimer);

        const codeField = document.querySelector(`input[name="SP${row}_port_code"]`);
        if (!codeField || !codeField.value.trim()) return;

        const nameField = document.querySelector(`input[name="SP${row}_port_name"]`);
        if (!nameField) return;

        let attempts = 0;
        const maxAttempts = 50; // 5s ceiling

        this._recheckTimer = setInterval(() => {
            attempts++;
            if (nameField.value.trim()) {
                clearInterval(this._recheckTimer);
                this.run();
                return;
            }
            if (attempts >= maxAttempts) clearInterval(this._recheckTimer);
        }, 100);
    }
};
