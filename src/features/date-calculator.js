// ─────────────────────────────────────────────────────
//  FEATURE: Date Calculator
//  Small floating panel toggled from the toolbar — type a
//  base date and a ± day offset, get the resulting date and
//  its weekday, live as you type (no "Calculate" button,
//  same always-live spirit as other panels in this codebase).
// ─────────────────────────────────────────────────────
const DateCalculator = {
    WEEKDAYS: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],

    init() {
        Toolbar.register({
            id:      "tt-date-calc",
            label:   "🗓 Date Calc",
            title:   "Open a calculator for adding or subtracting days from a date",
            group:   "date",
            onClick: () => this.togglePanel()
        });
    },

    togglePanel() {
        const existing = document.getElementById("tt-date-calc-panel");
        if (existing) {
            existing.remove();
            return;
        }
        this.buildPanel();
    },

    // Bottom-right, deliberately clear of the top-right warning/
    // success/suggestion banner stack (banner.js) and the top-left
    // Toolbar panel — nothing else lives here.
    buildPanel() {
        const panel = document.createElement("div");
        panel.id = "tt-date-calc-panel";
        panel.style.cssText = `
            position: fixed !important;
            bottom: 16px !important;
            right: 16px !important;
            z-index: 999996 !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: 2px solid #000000 !important;
            border-radius: 0px !important;
            box-shadow: 3px 3px 0px #000000 !important;
            font-family: monospace !important;
            font-size: 11px !important;
            letter-spacing: 0.5px !important;
            padding: 10px 14px !important;
            width: 190px !important;
            box-sizing: border-box !important;
        `;

        panel.innerHTML = `
            <div style="font-weight:bold; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                <span>🗓 Date Calc</span>
                <span id="tt-date-calc-close" style="cursor:pointer;">✕</span>
            </div>
            <label style="display:block; margin-bottom:3px;">Base date (MM/DD/YY)</label>
            <input id="tt-date-calc-base" type="text" style="width:100%; box-sizing:border-box; font-family:monospace; font-size:11px; padding:3px; border:1px solid #000000; margin-bottom:6px;">
            <label style="display:block; margin-bottom:3px;">± Days</label>
            <input id="tt-date-calc-offset" type="number" value="0" style="width:100%; box-sizing:border-box; font-family:monospace; font-size:11px; padding:3px; border:1px solid #000000; margin-bottom:8px;">
            <div id="tt-date-calc-result" style="font-weight:bold; border-top:1px dashed #000000; padding-top:6px;"></div>
        `;

        document.body.appendChild(panel);

        const baseInput   = panel.querySelector("#tt-date-calc-base");
        const offsetInput = panel.querySelector("#tt-date-calc-offset");
        const result      = panel.querySelector("#tt-date-calc-result");

        baseInput.value = DateUtils.todayMMDDYY();

        const recalc = () => this.recalc(baseInput, offsetInput, result);
        baseInput.addEventListener("input", recalc);
        offsetInput.addEventListener("input", recalc);
        panel.querySelector("#tt-date-calc-close").addEventListener("click", () => panel.remove());

        recalc();
    },

    recalc(baseInput, offsetInput, result) {
        const base = DateUtils.parse(baseInput.value);
        if (!base) {
            result.textContent = "Enter a valid date";
            return;
        }
        const offset = parseInt(offsetInput.value, 10) || 0;
        const target  = DateUtils.addDays(base, offset);
        const weekday = this.WEEKDAYS[target.getUTCDay()];
        result.textContent = `${DateUtils.format(target)} (${weekday})`;
    },

    // These panel inputs have no `name` attribute, so the shared
    // document-level change/blur delegated listeners in main.js never
    // match them against any other feature's field-name checks —
    // nothing to react to here.
    handle(_event)    {},
    handleBlur(_event) {}
};
