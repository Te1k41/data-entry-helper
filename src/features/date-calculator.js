// ─────────────────────────────────────────────────────
//  FEATURE: Date Calculator
//  Small floating panel toggled from the toolbar — 3 linked
//  fields (Base date, ± Days, Result date), no explicit mode
//  to pick. Editing ANY field marks it "freshest"; whichever
//  of the OTHER two hasn't been touched in the longest time
//  is what gets recomputed from the 2 freshest values — like
//  magnets, the 2 most recently touched fields always win as
//  the "given" values. All 3 pairwise directions (Base+Offset
//  ->Result, Base+Result->±Days, Result+±Days->Base) just fall
//  out of that one rule with no mode switch needed. Live as
//  you type, no "Calculate" button, same always-live spirit as
//  other panels in this codebase.
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
            <div id="tt-date-calc-base-row" style="display:flex; align-items:center; gap:2px; margin-bottom:2px;">
                <input id="tt-date-calc-base" type="text" style="flex:1; min-width:0; box-sizing:border-box; font-family:monospace; font-size:11px; padding:3px; border:1px solid #000000;">
            </div>
            <div id="tt-date-calc-base-weekday" style="color:#666666; margin-bottom:6px; min-height:12px;"></div>
            <label style="display:block; margin-bottom:3px;">± Days</label>
            <div id="tt-date-calc-offset-row" style="display:flex; align-items:center; gap:2px; margin-bottom:8px;">
                <input id="tt-date-calc-offset" type="number" value="0" style="flex:1; min-width:0; box-sizing:border-box; font-family:monospace; font-size:11px; padding:3px; border:1px solid #000000;">
            </div>
            <label style="display:block; margin-bottom:3px;">Result date (MM/DD/YY)</label>
            <div id="tt-date-calc-result-row" style="display:flex; align-items:center; gap:2px; margin-bottom:2px;">
                <input id="tt-date-calc-result" type="text" style="flex:1; min-width:0; box-sizing:border-box; font-family:monospace; font-size:11px; font-weight:bold; padding:3px; border:1px solid #000000;">
            </div>
            <div id="tt-date-calc-result-weekday" style="color:#666666; min-height:12px;"></div>
        `;

        document.body.appendChild(panel);

        const baseInput     = panel.querySelector("#tt-date-calc-base");
        const offsetInput   = panel.querySelector("#tt-date-calc-offset");
        const resultInput   = panel.querySelector("#tt-date-calc-result");
        const baseWeekday   = panel.querySelector("#tt-date-calc-base-weekday");
        const resultWeekday = panel.querySelector("#tt-date-calc-result-weekday");
        const baseRow       = panel.querySelector("#tt-date-calc-base-row");
        const offsetRow     = panel.querySelector("#tt-date-calc-offset-row");
        const resultRow     = panel.querySelector("#tt-date-calc-result-row");

        const fields = { baseInput, offsetInput, resultInput, baseWeekday, resultWeekday };

        baseInput.value = DateUtils.todayMMDDYY();

        // Most-recently-touched first. Starts with "result" last, so
        // the very first edit to anything (before the user has ever
        // touched a 2nd field) computes Result — the original default
        // "add N days" direction — same as before this redesign.
        let touchOrder = ["base", "offset", "result"];

        // Every field stays a normal, always-editable input — no
        // readOnly lock. Touching (typing into, or stepping) a field
        // just moves it to the front of touchOrder; whichever field
        // is now LAST (touched longest ago, or never) is the one
        // recomputed from the other 2's current values.
        const touch = (key) => {
            touchOrder = [key, ...touchOrder.filter(k => k !== key)];
            const staleField = touchOrder[2];
            this.recalcAll(fields, staleField);
            [baseInput, offsetInput, resultInput].forEach(input => input.style.background = "#ffffff");
            const staleInput = staleField === "base" ? baseInput : staleField === "offset" ? offsetInput : resultInput;
            staleInput.style.background = "#f0f0f0"; // just a hint which one is currently computed, not a lock
        };

        baseInput.addEventListener("input", () => touch("base"));
        offsetInput.addEventListener("input", () => touch("offset"));
        resultInput.addEventListener("input", () => touch("result"));
        panel.querySelector("#tt-date-calc-close").addEventListener("click", () => panel.remove());

        // Click-only controls for all 3 fields — same click=±1,
        // Shift+click=±7 convention as DateStepButtons' own [−][+]
        // pair, so the whole panel works without ever typing.
        baseRow.appendChild(this.makeActionButton("Today", () => {
            baseInput.value = DateUtils.todayMMDDYY();
            touch("base");
        }));
        baseRow.appendChild(this.makeStepButton("−", n => { this.stepDate(baseInput, -n); touch("base"); }));
        baseRow.appendChild(this.makeStepButton("+", n => { this.stepDate(baseInput, n); touch("base"); }));

        offsetRow.appendChild(this.makeStepButton("−", n => { this.stepOffset(offsetInput, -n); touch("offset"); }));
        offsetRow.appendChild(this.makeStepButton("+", n => { this.stepOffset(offsetInput, n); touch("offset"); }));

        resultRow.appendChild(this.makeStepButton("−", n => { this.stepDate(resultInput, -n); touch("result"); }));
        resultRow.appendChild(this.makeStepButton("+", n => { this.stepDate(resultInput, n); touch("result"); }));

        this.recalcAll(fields, touchOrder[2]);
        resultInput.style.background = "#f0f0f0";
    },

    // No valid date yet (empty/unparseable)? Base off today instead
    // of doing nothing — same fallback DateStepButtons uses. Shared by
    // both the Base and Result date fields.
    stepDate(input, deltaDays) {
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

    // Computes whichever ONE field `solveFor` names, from the other
    // 2's current values — the other 2 are never rewritten here.
    recalcAll({ baseInput, offsetInput, resultInput, baseWeekday, resultWeekday }, solveFor) {
        const DAY_MS = 86400000;

        if (solveFor === "base") {
            // Result + ± Days -> Base.
            const target = DateUtils.parse(resultInput.value);
            resultWeekday.textContent = target ? this.WEEKDAYS[target.getUTCDay()] : "⚠ Enter a valid date";
            if (!target) {
                baseInput.value = "";
                baseWeekday.textContent = "";
                return;
            }
            const offset = parseInt(offsetInput.value, 10) || 0;
            const base = DateUtils.addDays(target, -offset);
            baseInput.value = DateUtils.format(base);
            baseWeekday.textContent = this.WEEKDAYS[base.getUTCDay()];
            return;
        }

        if (solveFor === "offset") {
            // Base + Result -> ± Days.
            const base = DateUtils.parse(baseInput.value);
            baseWeekday.textContent = base ? this.WEEKDAYS[base.getUTCDay()] : "⚠ Enter a valid base date";
            const target = DateUtils.parse(resultInput.value);
            resultWeekday.textContent = target ? this.WEEKDAYS[target.getUTCDay()] : "⚠ Enter a valid date";
            if (!base || !target) return; // leave ± Days as-is until both sides are valid
            offsetInput.value = String(Math.round((target - base) / DAY_MS));
            return;
        }

        // solveFor === "result" (default): Base + ± Days -> Result.
        const base = DateUtils.parse(baseInput.value);
        baseWeekday.textContent = base ? this.WEEKDAYS[base.getUTCDay()] : "⚠ Enter a valid date";
        if (!base) {
            resultInput.value = "";
            resultWeekday.textContent = "";
            return;
        }
        const offset = parseInt(offsetInput.value, 10) || 0;
        const target = DateUtils.addDays(base, offset);
        resultInput.value = DateUtils.format(target);
        resultWeekday.textContent = this.WEEKDAYS[target.getUTCDay()];
    },

    // These panel inputs have no `name` attribute, so the shared
    // document-level change/blur delegated listeners in main.js never
    // match them against any other feature's field-name checks —
    // nothing to react to here.
    handle(_event)    {},
    handleBlur(_event) {}
};
