// ─────────────────────────────────────────────────────
//  FEATURE: SP001 Date Validation
//  Warns the user (via the shared banner) when SP001's
//  departure date doesn't match any SV vessel's departure
//  date, AND blocks Save in that same situation — a record
//  shouldn't save with its first port not actually basing on
//  any vessel. Blank SP001 is left alone (nothing to check yet,
//  same as the warning itself), only a non-blank date with no
//  match blocks.
//
//  The Save BUTTON lives in a different frame than this form
//  (confirmed live: onclick="parent.fr1.doSave()"). Two things
//  that DON'T work because of that: a "click" listener in this
//  frame never sees a click that happened in a sibling frame's
//  document, and confirmed live that window.doSave isn't even a
//  plain global anywhere (typeof came back "undefined" in every
//  frame checked) — there's nothing to wrap. Instead, this frame
//  (wherever SP001 lives) writes its mismatch state onto its own
//  <html> as a data attribute; separately, whichever frame
//  actually holds the Save button polls that attribute through
//  parent.fr1 (same-origin, so directly readable) and disables
//  its own button — no messaging needed, and it works regardless
//  of which frame either piece lives in.
// ─────────────────────────────────────────────────────
const SP001DateValidation = {

    SAVE_BUTTON_SELECTOR: 'input[type="button"][value="Save"]',
    MISMATCH_FLAG: "ttSp001Mismatch",

    setMismatchFlag(isMismatch) {
        if (isMismatch) document.documentElement.dataset[this.MISMATCH_FLAG] = "1";
        else delete document.documentElement.dataset[this.MISMATCH_FLAG];
    },

    // Checks THIS frame's own flag first (covers the rare case where
    // the Save button and the form happen to share a frame), then
    // every sibling frame under the same parent. Deliberately does NOT
    // hardcode the sibling's name (e.g. "fr1") — that's only confirmed
    // for one page/onclick, and a hardcoded name that doesn't hold on
    // some other record/page type would silently fail OPEN (never
    // blocks Save there) rather than throw, which is exactly the kind
    // of "sometimes doesn't work" bug worth not repeating a third time
    // this session. Each frame access is wrapped individually — one
    // inaccessible/cross-origin frame must not abort checking the rest.
    isSaveBlocked() {
        if (document.documentElement.dataset[this.MISMATCH_FLAG]) return true;

        let siblingFrames;
        try {
            siblingFrames = parent?.frames;
        } catch {
            return false;
        }
        if (!siblingFrames) return false;

        for (let i = 0; i < siblingFrames.length; i++) {
            try {
                if (siblingFrames[i]?.document?.documentElement?.dataset?.[this.MISMATCH_FLAG]) return true;
            } catch {
                // cross-origin or otherwise inaccessible — skip, keep checking the rest
            }
        }
        return false;
    },

    // No cross-frame event exists to tell this frame "the sibling's
    // mismatch state just changed" — polls instead. Cheap (one dataset
    // read), so a short interval doesn't cost anything real.
    //
    // The button search itself also polls briefly (100ms/50 attempts,
    // same shape as awr-flag.js's waitForNameThenRescan) rather than
    // checking once — a one-shot check at document_idle that finds
    // nothing just gives up forever, leaving Save silently never
    // gated for the rest of that page load if the button happened to
    // render a moment later than the rest of the frame.
    watchSaveButton() {
        const button = document.querySelector(this.SAVE_BUTTON_SELECTOR);
        if (button) {
            this.startWatching(button);
            return;
        }

        let attempts = 0;
        const maxAttempts = 50; // 5s ceiling
        const timer = setInterval(() => {
            attempts++;
            const found = document.querySelector(this.SAVE_BUTTON_SELECTOR);
            if (found) {
                clearInterval(timer);
                this.startWatching(found);
                return;
            }
            if (attempts >= maxAttempts) clearInterval(timer); // no Save button in this frame — nothing to manage
        }, 100);
    },

    startWatching(button) {
        setInterval(() => {
            const blocked = this.isSaveBlocked();
            if (button.disabled === blocked) return; // no change — skip the style writes
            button.disabled = blocked;
            button.title = blocked
                ? "Blocked: SP001's departure date doesn't match any vessel's departure date"
                : "";
            button.style.opacity = blocked ? "0.5" : "";
            button.style.cursor  = blocked ? "not-allowed" : "";
        }, 400);
    },

    validate() {
        const sp001 = document.querySelector('input[name="SP001_depart_date"]');
        if (!sp001) return;

        const spDate = sp001.value.trim();
        if (!spDate) {
            setWarning("sp001-mismatch", null);
            setInfoBanner(null);
            this.clearBasingHighlight();
            this.setMismatchFlag(false); // nothing to check yet — same as the warning
            return;
        }

        const match = this.findMatchingSVDate(spDate);

        if (match) {
            console.log(`✅ SP001 matches ${match}`);
            setWarning("sp001-mismatch", null);
            this.setMismatchFlag(false);

            const nameField = this.getVesselNameFieldForField(match);
            const vesselName = nameField?.value.trim();

            if (vesselName) {
                const voyageField = this.getVoyageFieldForField(match);
                const voyage = voyageField?.value.trim();
                const message = voyage ? `${vesselName} — ${voyage}` : vesselName;

                setInfoBanner({
                    title:   "⚓ Basing on",
                    message
                });
                this.applyBasingHighlight(nameField);
            } else {
                setInfoBanner(null);
                this.clearBasingHighlight();
            }
        } else {
            console.warn(`⚠ No SV departure matches ${spDate}`);
            setWarning("sp001-mismatch", {
                title:   "🚢 Vessel date mismatch",
                message: `No SV vessel found for ${spDate}`
            });
            setInfoBanner(null);
            this.clearBasingHighlight();
            this.setMismatchFlag(true);
        }
    },

    BASING_HIGHLIGHT: {
        outline:         "2px solid #1e5f9e",
        backgroundColor: "#dceeff"
    },

    // Clears the blue highlight from whichever field currently has it
    // (tracked via a data attribute, same safe pattern used by
    // vessel-no-date.js / port-no-date.js — only ever touches a field
    // THIS feature previously marked, never a blanket reset of every
    // vessel field).
    clearBasingHighlight() {
        const previous = document.querySelector('input[data-tt-basing-on]');
        if (previous) {
            previous.style.outline = "";
            previous.style.backgroundColor = "";
            delete previous.dataset.ttBasingOn;
        }
    },

    applyBasingHighlight(field) {
        const previous = document.querySelector('input[data-tt-basing-on]');
        if (previous && previous !== field) {
            previous.style.outline = "";
            previous.style.backgroundColor = "";
            delete previous.dataset.ttBasingOn;
        }

        field.style.outline         = this.BASING_HIGHLIGHT.outline;
        field.style.backgroundColor = this.BASING_HIGHLIGHT.backgroundColor;
        field.dataset.ttBasingOn    = "1";
    },

    // Given a matched field name like "SV003_depart_date", finds that
    // same row's vessel name FIELD ("SV003_vessel_name") — the actual
    // element, not just its value, so it can be styled.
    getVesselNameFieldForField(fieldName) {
        const rowMatch = fieldName.match(/^SV(\d+)_depart_date$/);
        if (!rowMatch) return null;

        return VesselRow.field(rowMatch[1], "vessel_name");
    },

    // Same row lookup, but for the voyage number field instead.
    getVoyageFieldForField(fieldName) {
        const rowMatch = fieldName.match(/^SV(\d+)_depart_date$/);
        if (!rowMatch) return null;

        return VesselRow.field(rowMatch[1], "start_voyage");
    },

    findMatchingSVDate(spDate) {
    const normalizedSP = DateUtils.normalize(spDate);
    const svFields = document.querySelectorAll(
        'input[name^="SV"][name$="_depart_date"]'
    );

    console.log(`🔍 Checking ${svFields.length} SV dates against ${normalizedSP}`);

    for (const field of svFields) {
        const rowMatch = field.name.match(/^SV(\d+)_depart_date$/);
        if (!rowMatch) continue;

        // Only a row that actually has a vessel counts as a match -- a
        // stale date left behind in an otherwise-blank row (e.g. after
        // typing then clearing a vessel name) would otherwise silently
        // pass validation for a vessel that isn't really there.
        const nameField = VesselRow.field(rowMatch[1], "vessel_name");
        if (!nameField || !nameField.value.trim()) continue;

        const normalizedSV = DateUtils.normalize(field.value);
        if (normalizedSV && normalizedSV === normalizedSP) {
            console.log(`✅ Match found: ${field.name}`);
            return field.name;
        }
    }

    return null;
},

    // --- Module interface ---

    init() {
        // Run once immediately on load too — otherwise a service opened
        // with pre-filled dates (no edit made yet) never shows the
        // mismatch warning or the "Basing on" banner until you happen
        // to touch a date field yourself.
        this.validate();

        this.watchSaveButton();
    },

    handle(event) {
        const { name } = event.target;
        const isSVDate  = name?.startsWith("SV") && name?.endsWith("_depart_date");
        const isSP001   = name === "SP001_depart_date" || name === "SP001_arrival_date";

        if (isSVDate || isSP001) {
            this.validate();
        }
    }
};
