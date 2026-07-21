// ============================================================
//  src/utils/voyage.js
//  Shared voyage-code stepping logic, used by both the manual
//  [-][+] voyage step buttons (features/voyage-step-buttons.js)
//  and the "🛠 Fix Vessel Dates" auto-correction (features/
//  vessel-correction.js) — one place for "what does +N mean for
//  a voyage code" so both stay consistent.
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
    }
};