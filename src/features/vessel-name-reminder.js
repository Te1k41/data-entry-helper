// ─────────────────────────────────────────────────────
//  FEATURE: Vessel Name Reminder (Voyage Number / Vessel Depart Date)
//  Same idea as port-name-reminder.js, for the SV### "vessel" rows
//  instead of the SP### "port" rows: Start Voyage and the vessel's own
//  Depart Date sit far enough from Vessel Name that it can scroll out
//  of view by the time you're editing them. Shows a small floating
//  "🚢 EVER GIVEN" label next to whichever of those two fields
//  currently has focus, so you can tell which vessel you're on without
//  scrolling back left.
//
//  Pure overlay — never touches any real field or DOM structure, just
//  a fixed-position label that appears on focus and disappears on blur.
// ─────────────────────────────────────────────────────
const VesselNameReminder = {
    FIELD_PATTERN: /^SV(\d+)_(?:start_voyage|depart_date)$/,

    activeField: null,

    buildLabel() {
        let label = document.getElementById("tt-vessel-reminder");
        if (label) return label;

        label = document.createElement("div");
        label.id = "tt-vessel-reminder";
        label.style.cssText = `
            position: fixed !important;
            z-index: 2147483647 !important;
            background: #1e5f9e !important;
            color: #ffffff !important;
            font-family: monospace !important;
            font-size: 11px !important;
            font-weight: bold !important;
            padding: 3px 8px !important;
            border: 1px solid #0a3d6e !important;
            box-shadow: 2px 2px 0px rgba(0, 0, 0, 0.3) !important;
            pointer-events: none !important;
            white-space: nowrap !important;
            display: none !important;
        `;
        document.body.appendChild(label);
        return label;
    },

    reposition() {
        if (!this.activeField) return;
        const label = this.buildLabel();
        const rect = this.activeField.getBoundingClientRect();
        label.style.top  = `${rect.top - label.offsetHeight - 4}px`;
        label.style.left = `${rect.left}px`;
    },

    show(field, vesselName) {
        const label = this.buildLabel();
        label.textContent = `🚢 ${vesselName}`;
        label.style.display = "block";
        this.activeField = field;
        this.reposition();
    },

    hide() {
        const label = document.getElementById("tt-vessel-reminder");
        if (label) label.style.display = "none";
        this.activeField = null;
    },

    init() {
        // Capture-phase scroll (see main.js's focus/blur delegation for why
        // capture is needed) so this also tracks scrolling inside a nested
        // container, not just the window itself.
        window.addEventListener("scroll", () => this.reposition(), true);
        window.addEventListener("resize", () => this.reposition());
    },

    handleFocus(event) {
        const { name } = event.target;
        if (!name || name.startsWith("PV_") || !this.FIELD_PATTERN.test(name)) return;

        const row = name.match(this.FIELD_PATTERN)[1];
        const vesselField = document.querySelector(`input[name="SV${row}_vessel_name"]`);
        if (!vesselField || !vesselField.value.trim()) return;

        this.show(event.target, vesselField.value.trim());
    },

    handleBlur(event) {
        const { name } = event.target;
        if (name && this.FIELD_PATTERN.test(name)) this.hide();
    },

    handle(_event) {}
};
