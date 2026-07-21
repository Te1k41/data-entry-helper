// ============================================================
//  FEATURE: Voyage Number Step Buttons
//  Adds tiny [−] and [+] buttons right next to every vessel
//  voyage number field (SV*_start_voyage) on tradetech.net, so
//  a voyage code can be nudged without retyping it.
//
//  Voyage codes can have more than one number in them, e.g.
//  "2698-102" — every digit run in the code is stepped by the
//  same amount, each keeping its own zero-padded width, so
//  decreasing "2698-102" by 1 gives "2697-101" (both numbers
//  move together). A single-number code with a trailing letter,
//  e.g. "0042A", steps the same way — only "0042" changes, the
//  "A" is untouched. A non-numeric placeholder like "TBN" has no
//  digit runs at all, so stepping it does nothing.
//
//  Click = ±1. Shift+Click = ± the "voyage_increment_by" field's
//  value (the same field the "🛠 Fix Vessel Dates" button already
//  reads via VesselVoyageCorrection.getVoyageIncrement()) — but
//  only when that value is greater than 0; otherwise Shift+Click
//  just falls back to ±1, same as a plain click.
//
//  Unlike the date step buttons, this one does NOT need the
//  syncing guard: nothing else in this codebase reacts specially
//  to a syncing flag for _start_voyage changes. voyage-direction.js
//  DOES react to this field's change event (appending a compass
//  direction letter when applicable) — that's normal, desired
//  behavior here, same as if the code had been typed by hand, so
//  it's intentionally left free to run.
//
//  Tradetech keeps a hidden PV_ duplicate of this field with no
//  listeners of its own — mirrored directly by value, same
//  approach vessel-correction.js already uses for this exact
//  field. We read the field's value back AFTER writing (rather
//  than reusing our own computed string) in case voyage-direction.js
//  appended a letter to it in the meantime.
// ============================================================
const VoyageStepButtons = {
    SELECTOR: 'input[name$="_start_voyage"]:not([name^="PV_"])',

    init() {
        this.addButtons();
    },

    addButtons() {
        document.querySelectorAll(this.SELECTOR).forEach(field => {
            if (field.dataset.ttStepButtonsAdded) return; // never double-inject
            field.dataset.ttStepButtonsAdded = "1";
            this.wrapField(field);
        });
    },

    wrapField(field) {
        const minus = this.makeStepButton("−", field, -1);
        const plus  = this.makeStepButton("+", field, 1);

        // [ field ][ − ][ + ]
        field.insertAdjacentElement("afterend", minus);
        minus.insertAdjacentElement("afterend", plus);
    },

    makeStepButton(label, field, direction) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = direction > 0
            ? "+1 (Shift = + voyage_increment_by, if > 0)"
            : "-1 (Shift = - voyage_increment_by, if > 0)";

        btn.style.cssText = `
            display: inline-block !important;
            width: 18px !important;
            height: 18px !important;
            line-height: 14px !important;
            padding: 0 !important;
            margin-left: 2px !important;
            font-family: monospace !important;
            font-size: 12px !important;
            font-weight: bold !important;
            text-align: center !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: 1px solid #000000 !important;
            border-radius: 0px !important;
            cursor: pointer !important;
            vertical-align: middle !important;
            box-sizing: border-box !important;
        `;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const magnitude = e.shiftKey ? this.getShiftMagnitude() : 1;
            this.step(field, direction * magnitude);
        });

        return btn;
    },

    // Shift+Click jumps by the "voyage_increment_by" field's value —
    // reusing VesselVoyageCorrection's own reader so both features
    // agree on what that field means — but only if it's > 0. A blank,
    // zero, or negative increment falls back to the same ±1 a plain
    // click would do, rather than doing nothing or going backwards
    // unexpectedly.
    getShiftMagnitude() {
        const increment = VesselVoyageCorrection.getVoyageIncrement();
        return increment > 0 ? increment : 1;
    },

    step(field, delta) {
        const current = field.value.trim();
        if (!current) return; // nothing to step yet

        const next = VoyageUtils.step(current, delta);
        if (next === current) return; // no digit runs — nothing changed

        setFieldValue(field, next);

        // Mirror into the hidden PV_ duplicate — read the field's
        // value back (not our own `next`) in case voyage-direction.js
        // just appended a direction letter to it.
        const pvField = document.querySelector(`input[name="PV_${field.name}"]`);
        if (pvField) pvField.value = field.value;
    },

    // Required by the FEATURES interface — this feature only cares
    // about init-time button injection, so both are no-ops.
    handle(_event)    {},
    handleBlur(_event) {}
};