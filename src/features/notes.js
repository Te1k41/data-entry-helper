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

        // Replace any bare 6-digit run (062526) and any slash-formatted
        // date (06/25/26) anywhere in the notes text with today's date,
        // in the matching format. \b = word boundary, so this won't
        // partially match inside a longer number.
        const updated = pvNotes.value
            .replace(/\b\d{6}\b/g,          todayNS) // bare 6-digit dates
            .replace(/\b\d{2}\/\d{2}\/\d{2}\b/g, today); // slash dates

        // Only write back if something actually changed, to avoid an
        // unnecessary write on every page load.
        if (updated !== pvNotes.value) {
            pvNotes.value = updated;
            console.log(`📅 Notes dates replaced with today: ${today}`);
        }
    },

    // No auto-trigger needed — this only runs once at page load.
    handle(_event) {
    }
};
