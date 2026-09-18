// ─────────────────────────────────────────────────────
//  FEATURE: Date Calculator
//  Small floating panel toggled from the toolbar — 3 linked
//  fields (Base date, ± Days, Result date), any of which can
//  be edited directly. Editing Base or ± Days recomputes
//  Result (the normal "add N days" direction); editing Result
//  instead recomputes ± Days, solving "what offset gets me
//  from Base to this date" — Base itself is never overwritten
//  by editing one of the other two, it's always the anchor.
//  Live as you type, no "Calculate" button, same always-live
//  spirit as other panels in this codebase.
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

        // Base and ± Days both compute Result (the normal "add N days"
        // direction) — editing Result instead solves for ± Days,
        // keeping Base untouched as the anchor either way. Step
        // buttons route through the exact same two functions as
        // typing does, just via a direct value mutation first.
        const recalcFromBase   = () => this.recalcToResult(fields);
        const recalcFromOffset = () => this.recalcToResult(fields);
        const recalcFromResult = () => this.recalcToOffset(fields);

        baseInput.addEventListener("input", recalcFromBase);
        offsetInput.addEventListener("input", recalcFromOffset);
        resultInput.addEventListener("input", recalcFromResult);
        panel.querySelector("#tt-date-calc-close").addEventListener("click", () => panel.remove());

        // Click-only controls for all 3 fields — same click=±1,
        // Shift+click=±7 convention as DateStepButtons' own [−][+]
        // pair, so the whole panel works without ever typing.
        baseRow.appendChild(this.makeActionButton("Today", () => {
            baseInput.value = DateUtils.todayMMDDYY();
            recalcFromBase();
        }));
        baseRow.appendChild(this.makeStepButton("−", n => {
            this.stepDate(baseInput, -n);
            recalcFromBase();
        }));
        baseRow.appendChild(this.makeStepButton("+", n => {
            this.stepDate(baseInput, n);
            recalcFromBase();
        }));

        offsetRow.appendChild(this.makeStepButton("−", n => {
            this.stepOffset(offsetInput, -n);
            recalcFromOffset();
        }));
        offsetRow.appendChild(this.makeStepButton("+", n => {
            this.stepOffset(offsetInput, n);
            recalcFromOffset();
        }));

        resultRow.appendChild(this.makeStepButton("−", n => {
            this.stepDate(resultInput, -n);
            recalcFromResult();
        }));
        resultRow.appendChild(this.makeStepButton("+", n => {
            this.stepDate(resultInput, n);
            recalcFromResult();
        }));

        recalcFromBase();
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

    // Base + ± Days -> Result (the normal "add N days" direction).
    recalcToResult({ baseInput, offsetInput, resultInput, baseWeekday, resultWeekday }) {
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

    // Result -> ± Days, solving "what offset gets me from Base to
    // this Result date". Base is never rewritten here — it's always
    // the anchor, regardless of which field was just edited.
    recalcToOffset({ baseInput, offsetInput, resultInput, baseWeekday, resultWeekday }) {
        const base = DateUtils.parse(baseInput.value);
        baseWeekday.textContent = base ? this.WEEKDAYS[base.getUTCDay()] : "⚠ Enter a valid base date";

        const target = DateUtils.parse(resultInput.value);
        resultWeekday.textContent = target ? this.WEEKDAYS[target.getUTCDay()] : "⚠ Enter a valid date";

        if (!base || !target) return; // leave ± Days as-is until both sides are valid

        const offsetDays = Math.round((target - base) / 86400000);
        offsetInput.value = String(offsetDays);
    },

    // These panel inputs have no `name` attribute, so the shared
    // document-level change/blur delegated listeners in main.js never
    // match them against any other feature's field-name checks —
    // nothing to react to here.
    handle(_event)    {},
    handleBlur(_event) {}
};
