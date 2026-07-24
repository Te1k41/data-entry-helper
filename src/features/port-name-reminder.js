// ─────────────────────────────────────────────────────
//  FEATURE: Port Name Reminder (Arrival/Depart date fields)
//  Arrival Date/Departure Date sit several columns to the right
//  of Port Name on a wide row — by the time you've scrolled over
//  to edit a date, the port name has usually scrolled out of
//  view. Shows a small floating "⚓ SYDNEY, AUSTRALIA" label next
//  to whichever date field currently has focus, so you can tell
//  which port you're on without scrolling back left.
//
//  Pure overlay — never touches any real field or DOM structure,
//  just a fixed-position label that appears on focus and
//  disappears on blur.
// ─────────────────────────────────────────────────────
const PortNameReminder = {
    FIELD_PATTERN: /^SP(\d+)_(?:arrival|depart)_date$/,

    activeField: null,

    buildLabel() {
        let label = document.getElementById("tt-port-reminder");
        if (label) return label;

        label = document.createElement("div");
        label.id = "tt-port-reminder";
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

    show(field, portName) {
        const label = this.buildLabel();
        label.textContent = `⚓ ${portName}`;
        label.style.display = "block";
        this.activeField = field;
        this.reposition();
    },

    hide() {
        const label = document.getElementById("tt-port-reminder");
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
        if (!name || !this.FIELD_PATTERN.test(name)) return;

        const row = name.match(this.FIELD_PATTERN)[1];
        const portField = document.querySelector(`input[name="SP${row}_port_name"]`);
        if (!portField || !portField.value.trim()) return;

        this.show(event.target, portField.value.trim());
    },

    handleBlur(event) {
        const { name } = event.target;
        if (name && this.FIELD_PATTERN.test(name)) this.hide();
    },

    handle(_event) {}
};
