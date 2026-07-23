// ============================================================
//  FEATURE: Date Step Buttons
//  Adds tiny [−] and [+] buttons right next to every arrival/
//  depart date field on tradetech.net, so a date can be nudged
//  without retyping it by hand.
//
//  Covers every field matching:
//    input[name$="_arrival_date"]   e.g. SP001_arrival_date
//    input[name$="_depart_date"]    e.g. SP001_depart_date, SV003_depart_date
//  (the "_diff" fields, e.g. SP001_arrival_date_diff, are numeric
//  day-offsets rather than calendar dates and do NOT match this
//  suffix, so they're correctly left alone.)
//
//  Tradetech also keeps a hidden "PV_" duplicate of many fields
//  (PV_SP001_arrival_date, etc.) for its own previous-value
//  tracking — every other feature in this codebase that does a
//  name-suffix match excludes these (see vessel-recommendation.js,
//  port-no-date.js, keyboard-navigation.js...). Without that
//  exclusion, each PV_ shadow field would ALSO get its own
//  [-][+] pair injected — since the shadow field itself is
//  hidden but the buttons we create are not, that showed up as
//  stray duplicate buttons elsewhere in the layout.
//
//  Click     = ±1 day
//  Shift+Click = ±7 days (a week)
//
//  Same-row arrival/depart pairs (SP*) are kept sane: if stepping
//  arrival would push it past depart, or stepping depart would
//  push it before arrival, the OTHER field shifts by the same
//  number of days too — preserving whatever gap already existed
//  between them instead of leaving an impossible date order.
//
//  All writes go through setFieldValue() (src/utils/dom.js) so
//  Tradetech's own scripts, and this extension's other features
//  (validation, schedule-cascade, etc.), see a real "change"
//  event — exactly as if the date had been typed by hand.
// ============================================================
const DateStepButtons = {
    SELECTOR: 'input[name$="_arrival_date"]:not([name^="PV_"]), input[name$="_depart_date"]:not([name^="PV_"])',

    init() {
        this.addButtons();
    },

    // Runs once at page load (same one-time-scan pattern every other
    // feature here uses — Tradetech's date rows are already present
    // in the DOM by document_idle, nothing is added dynamically after).
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

        // [ field ][ − ][ + ]  — minus goes right after the field,
        // then plus goes right after minus.
        field.insertAdjacentElement("afterend", minus);
        minus.insertAdjacentElement("afterend", plus);
    },

    makeStepButton(label, field, direction) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = direction > 0
            ? "+1 day (Shift = +7 days)"
            : "-1 day (Shift = -7 days)";

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
            const step = e.shiftKey ? 7 : 1;
            this.step(field, direction * step);
        });

        return btn;
    },

    step(field, deltaDays) {
        // No valid date yet (empty/unparseable)? Base off today instead
        // of doing nothing — so a blank field is still usable.
        const current = DateUtils.parse(field.value);
        const base    = current || this.todayUTCMidnight();
        const next    = DateUtils.addDays(base, deltaDays);

        // SP001 is the exception (see date-syncing.js): it has its own
        // bidirectional sync (depart→arrival, and arrival→depart via the
        // general path) instead of the one-directional arrival→depart
        // every other row gets. That sync should keep working when
        // stepping SP001 with +/-, exactly as if the date had been
        // typed by hand — so SP001 is deliberately NOT guarded below.
        if (field.name === "SP001_arrival_date" || field.name === "SP001_depart_date") {
            setFieldValue(field, DateUtils.format(next));
            return;
        }

        // Every other row: date-syncing.js auto-copies arrival→depart
        // whenever either one changes. That's the right behavior for a
        // normal edit, but it means nudging JUST the arrival date with
        // these buttons would immediately get overwritten onto the
        // depart date too (or vice versa) — the two buttons couldn't
        // move a date independently.
        //
        // syncing is the codebase's existing re-entrancy guard (see
        // main.js): any feature that writes a value sets it to true
        // first, and date-syncing.js's handle() bails immediately when
        // it's true. Using it here means our own write to THIS field
        // doesn't trigger date-syncing's copy onto the other field —
        // arrival and depart can each be stepped on their own.
        syncing = true;
        try {
            setFieldValue(field, DateUtils.format(next));
            this.keepArrivalBeforeDepart(field, next, deltaDays);
        } finally {
            syncing = false; // always release the guard, even on error
        }
    },

    // Same-row port arrival/depart can never make sense crossed —
    // arrival must not land after depart, and depart must not land
    // before arrival. If stepping one of them just caused that, shift
    // the OTHER one by the same number of days (not to a fixed value),
    // so whatever gap already existed between them is preserved rather
    // than collapsed. Symmetric: works whether you stepped arrival
    // forward past depart, or depart backward past arrival.
    keepArrivalBeforeDepart(field, newDate, deltaDays) {
        const counterpart = this.findCounterpartField(field);
        if (!counterpart) return;

        const counterpartDate = DateUtils.parse(counterpart.value);
        if (!counterpartDate) return;

        const isArrival = field.name.endsWith("_arrival_date");
        const violated = isArrival
            ? newDate > counterpartDate   // arrival now lands after depart
            : newDate < counterpartDate;  // depart now lands before arrival

        if (!violated) return;

        const shifted = DateUtils.addDays(counterpartDate, deltaDays);
        setFieldValue(counterpart, DateUtils.format(shifted));
    },

    // Same-row arrival<->depart field, e.g. SP004_arrival_date <->
    // SP004_depart_date. SV rows only have a depart_date (no arrival
    // counterpart), so this correctly returns null for those.
    findCounterpartField(field) {
        let counterpartName = null;
        if (field.name.endsWith("_arrival_date")) {
            counterpartName = field.name.replace("_arrival_date", "_depart_date");
        } else if (field.name.endsWith("_depart_date")) {
            counterpartName = field.name.replace("_depart_date", "_arrival_date");
        }
        if (!counterpartName) return null;

        return document.querySelector(`input[name="${counterpartName}"]:not([name^="PV_"])`);
    },

    todayUTCMidnight() {
        const now = new Date();
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    },

    // Required by the FEATURES interface (main.js calls these on every
    // field change/blur) — this feature only cares about init-time
    // button injection, so both are no-ops.
    handle(_event)    {},
    handleBlur(_event) {}
};