// ============================================================
//  src/utils/voyage.js
//  Shared voyage-code helpers, used by the manual [-][+] voyage step
//  buttons (features/voyage-step-buttons.js) and duplicate-vessel.js's
//  chained-voyage duplicate — one place for "what does +N mean for a
//  voyage code" so both stay consistent.
// ============================================================
const VoyageUtils = {
    // Steps EVERY digit run in a voyage code by the same amount, each
    // keeping its own zero-padded width.
    //   "2698-102" step -1  => "2697-101"   (both numbers move together)
    //   "0042A"    step -1  => "0041A"      (letter suffix untouched)
    //   "TBN"      step +1  => "TBN"        (no digits, unchanged)
    // Never lets any individual number go below 0.
    step(code, delta) {
        if (!code) return code;
        return code.replace(/\d+/g, (digits) => {
            const width = digits.length;
            let num = parseInt(digits, 10) + delta;
            if (num < 0) num = 0;
            return String(num).padStart(width, "0");
        });
    },

    // How much a Shift+Click / chained duplicate should step a voyage
    // code by, per the page's own voyage_increment_by field. Defaults to
    // 1 if the field is missing or not a valid number. Used by both
    // voyage-step-buttons.js and duplicate-vessel.js so a page-configured
    // increment behaves identically in either place.
    getIncrement() {
        const field = document.querySelector('input[name="voyage_increment_by"]');
        if (!field) return 1;
        const val = parseInt(field.value.trim(), 10);
        return isNaN(val) ? 1 : val;
    }
};