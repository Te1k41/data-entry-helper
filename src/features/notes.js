// ─────────────────────────────────────────────────────
//  FEATURE: Notes Date Replacement
//  On page load, finds any stale date already typed into
//  the notes textarea and swaps it for today's date,
//  keeping whichever format (slash or bare digits) was
//  already being used.
// ─────────────────────────────────────────────────────
const NotesDateReplacement = {

    init() {
        const pvNotes = document.querySelector('textarea[name="notes"]');
        if (!pvNotes) return; // no notes field on this page, nothing to do

        const today   = DateUtils.todayMMDDYY();     // e.g. "06/25/26"
        const todayNS = today.replace(/\//g, "");     // "062526" (no slashes)

        // A bare 6-digit run or DD/DD/DD run isn't necessarily a date —
        // could just as easily be a reference number, container digits,
        // etc. sitting in someone's free-text notes. Only replace a match
        // that actually round-trips through DateUtils as a real calendar
        // date (this also rejects e.g. "02/30/26", which DateUtils.parse
        // would otherwise silently roll over into March).
        // A schedule note's stale date is always close to today (this
        // extension is used daily) — a reference number that happens to
        // LOOK like a valid calendar date is still very unlikely to look
        // like a NEARBY one, so bounding the year rules out most of that
        // residual overlap (e.g. "111199" parses as a real date, Nov 2099,
        // but is 70+ years away — clearly not a stale note date).
        const YEAR_WINDOW = 3;
        const currentYear = new Date().getUTCFullYear();

        const isRealDate = (candidate) => {
            const parsed = DateUtils.parse(candidate);
            if (!parsed || isNaN(parsed.getTime())) return false;
            // Re-serialize and compare digits only, so this works for both
            // the bare and slash-formatted candidate shapes — catches
            // invalid calendar dates too (e.g. "02/30/26"), which
            // DateUtils.parse's underlying Date constructor would
            // otherwise silently roll over into a different day instead
            // of rejecting.
            if (DateUtils.format(parsed).replace(/\D/g, "") !== candidate.replace(/\D/g, "")) return false;
            return Math.abs(parsed.getUTCFullYear() - currentYear) <= YEAR_WINDOW;
        };

        // Replace any bare 6-digit run (062526) and any slash-formatted
        // date (06/25/26) anywhere in the notes text with today's date,
        // in the matching format — but only when it's a real date. \b =
        // word boundary, so this won't partially match inside a longer number.
        const updated = pvNotes.value
            .replace(/\b\d{6}\b/g, match => isRealDate(match) ? todayNS : match)
            .replace(/\b\d{2}\/\d{2}\/\d{2}\b/g, match => isRealDate(match) ? today : match);

        // Only write back if something actually changed, to avoid an
        // unnecessary write on every page load. Goes through setFieldValue()
        // (not a plain .value assignment) so anything else watching this
        // field — e.g. NotesSidebar's mirror — sees the change via a real
        // "input" event instead of depending on init() run order.
        if (updated !== pvNotes.value) {
            setFieldValue(pvNotes, updated);
            console.log(`📅 Notes dates replaced with today: ${today}`);
        }
    },

    // No auto-trigger needed — this only runs once at page load.
    handle(_event) {
    }
};
