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
        if (!isOnScheduleForm()) return;

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
            <div id="tt-date-calc-base-row" style="display:flex; align-items:center; gap:2px; margin-bottom:6px;">
                <input id="tt-date-calc-base" type="text" style="flex:1; min-width:0; box-sizing:border-box; font-family:monospace; font-size:11px; padding:3px; border:1px solid #000000;">
            </div>
            <label style="display:block; margin-bottom:3px;">± Days</label>
            <div id="tt-date-calc-offset-row" style="display:flex; align-items:center; gap:2px; margin-bottom:8px;">
                <input id="tt-date-calc-offset" type="number" value="0" style="flex:1; min-width:0; box-sizing:border-box; font-family:monospace; font-size:11px; padding:3px; border:1px solid #000000;">
            </div>
            <div id="tt-date-calc-result" style="font-weight:bold; border-top:1px dashed #000000; padding-top:6px;"></div>
        `;

        document.body.appendChild(panel);

        const baseInput   = panel.querySelector("#tt-date-calc-base");
        const offsetInput = panel.querySelector("#tt-date-calc-offset");
        const result      = panel.querySelector("#tt-date-calc-result");
        const baseRow     = panel.querySelector("#tt-date-calc-base-row");
        const offsetRow   = panel.querySelector("#tt-date-calc-offset-row");

        baseInput.value = DateUtils.todayMMDDYY();

        const recalc = () => this.recalc(baseInput, offsetInput, result);
        baseInput.addEventListener("input", recalc);
        offsetInput.addEventListener("input", recalc);
        panel.querySelector("#tt-date-calc-close").addEventListener("click", () => panel.remove());

        // Click-only controls for both fields — same click=±1,
        // Shift+click=±7 convention as DateStepButtons' own [−][+]
        // pair, so the whole panel works without ever typing.
        baseRow.appendChild(this.makeActionButton("Today", () => {
            baseInput.value = DateUtils.todayMMDDYY();
            recalc();
        }));
        baseRow.appendChild(this.makeStepButton("−", n => {
            this.stepBaseDate(baseInput, -n);
            recalc();
        }));
        baseRow.appendChild(this.makeStepButton("+", n => {
            this.stepBaseDate(baseInput, n);
            recalc();
        }));

        offsetRow.appendChild(this.makeStepButton("−", n => {
            this.stepOffset(offsetInput, -n);
            recalc();
        }));
        offsetRow.appendChild(this.makeStepButton("+", n => {
            this.stepOffset(offsetInput, n);
            recalc();
        }));

        recalc();
    },

    // No valid base date yet (empty/unparseable)? Base off today
    // instead of doing nothing — same fallback DateStepButtons uses.
    stepBaseDate(input, deltaDays) {
        const base = DateUtils.parse(input.value) || DateUtils.parse(DateUtils.todayMMDDYY());
        input.value = DateUtils.format(DateUtils.addDays(base, deltaDays));
    },

    stepOffset(input, delta) {
        const current = parseInt(input.value, 10) || 0;
        input.value = String(current + delta);
    },

    // Shared button chrome for both the [−][+] steppers and "Today" —
    // click = ±1 day, Shift+click = ±7, same convention DateStepButtons
    // already uses on the real page fields. `onClick` receives the
    // step size (1 or 7) already resolved; a fixed action like "Today"
    // just ignores the argument.
    makeStepButton(label, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = "Click = ±1 day, Shift+Click = ±7 days";
        btn.style.cssText = `
            flex-shrink: 0 !important;
            width: 20px !important;
            height: 20px !important;
            line-height: 16px !important;
            padding: 0 !important;
            font-family: monospace !important;
            font-size: 12px !important;
            font-weight: bold !important;
            text-align: center !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: 1px solid #000000 !important;
            cursor: pointer !important;
            box-sizing: border-box !important;
        `;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            onClick(e.shiftKey ? 7 : 1);
        });
        return btn;
    },

    makeActionButton(label, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.style.cssText = `
            flex-shrink: 0 !important;
            height: 20px !important;
            padding: 0 6px !important;
            font-family: monospace !important;
            font-size: 10px !important;
            font-weight: bold !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: 1px solid #000000 !important;
            cursor: pointer !important;
            box-sizing: border-box !important;
        `;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            onClick();
        });
        return btn;
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
