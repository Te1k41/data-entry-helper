// ─────────────────────────────────────────────────────
//  FEATURE: ETA ↔ ETD Date Syncing
//  Most rows: arrival date → departure date (same row).
//  SP001 is the exception: departure → arrival (reverse),
//  since SP001 is the starting leg of the shipment.
//  Rows past the route's "loop-back" boundary (see
//  core/boundary.js) are skipped so a repeating route
//  doesn't get the wrong leg's date applied to it.
// ─────────────────────────────────────────────────────
const DateSyncing = {
    init() {
        // Nothing needed on load — this is purely event-driven.
    },

    handle(event) {
        // Bail if a write is already in progress (loop guard, see main.js)
        if (isSyncing()) return;

        const target = event.target;
        if (target.tagName !== "INPUT" || !target.name) return;

        // ── Special case: SP001 departure → arrival (reverse direction) ──
        if (target.name === "SP001_depart_date") {
            const arrivalInput = document.querySelector('input[name="SP001_arrival_date"]');
            if (!arrivalInput) return;

            // Don't duplicate a wrong/incomplete value into arrival — only
            // sync once depart is an actually-parseable date.
            if (!DateUtils.parse(target.value)) {
                console.log("⏭ SP001 ETD not a valid date yet — skipping sync");
                return;
            }

            console.log("🔄 SP001 ETD changed, syncing → arrival");
            beginSync();
            try {
                setFieldValue(arrivalInput, target.value);
                console.log("🎉 Synced SP001_depart_date → SP001_arrival_date");
            } catch (err) {
                console.error("❌ Error syncing SP001:", err);
            } finally {
                endSync(); // always release the guard, even on error
            }

            // SP001's dates just changed, so re-check the mismatch banner.
            SP001DateValidation.validate();
            return;
        }

        // ── Every other row: arrival → departure ──
        if (!target.name.endsWith("_arrival_date")) return;

        console.log("🎯 Arrival date changed:", target.name, "→", target.value);

        // Don't duplicate a wrong/incomplete value into depart — only sync
        // once arrival is an actually-parseable date.
        if (!DateUtils.parse(target.value)) {
            console.log("⏭ Arrival date not a valid date yet — skipping sync");
            return;
        }

        // Extract the row number (e.g. "SP004_arrival_date" → 4) and
        // check whether this row sits past the route's loop-back point.
        const spRowMatch = target.name.match(/^SP(\d+)_arrival_date$/);
        if (spRowMatch) {
            const spRow = parseInt(spRowMatch[1], 10);
            if (PortSyncBoundary.shouldBlock(spRow)) {
                console.log(`🚫 Sync blocked for SP${String(spRow).padStart(3, "0")}`);
                return;
            }
        }

        // Build the matching departure field name by string substitution
        // and find it on the page.
        const departName  = target.name.replace("_arrival_date", "_depart_date");
        const departInput = document.querySelector(`input[name="${departName}"]`);

        if (!departInput) {
            console.error("❌ Departure field not found:", departName);
            return;
        }

        beginSync();
        try {
            setFieldValue(departInput, target.value);
            console.log(`🎉 Synced ${target.name} → ${departName}`);
        } catch (err) {
            console.error("❌ Error syncing dates:", err);
        } finally {
            endSync();
        }

        // SP001's arrival indirectly affects the validation banner too.
        if (target.name === "SP001_arrival_date") {
            SP001DateValidation.validate();
        }
    }
};
