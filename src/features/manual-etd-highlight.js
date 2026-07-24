// ─────────────────────────────────────────────────────
//  FEATURE: Manual ETD Highlight (past the sync boundary)
//  date-syncing.js only auto-syncs arrival → depart up to the
//  route's loop-back boundary (see core/boundary.js /
//  PortSyncBoundary.shouldBlock()) — any row past that point
//  never gets an auto-synced departure date, so if one has a
//  value, the user typed it in by hand. Highlights those
//  manually-entered departure dates so it's clear at a glance
//  which ones aren't coming from the sync.
// ─────────────────────────────────────────────────────
const ManualEtdHighlight = {
    HIGHLIGHT_STYLE: {
        outline: "2px solid #0e8a6e",
        backgroundColor: "#e0fbf5"
    },

    applyHighlight(field) {
        field.style.outline = this.HIGHLIGHT_STYLE.outline;
        field.style.backgroundColor = this.HIGHLIGHT_STYLE.backgroundColor;
        field.dataset.ttManualEtd = "1";
    },

    clearHighlight(field) {
        field.style.outline = "";
        field.style.backgroundColor = "";
        delete field.dataset.ttManualEtd;
    },

    run() {
        // Clear whatever this feature previously flagged before re-scanning
        // — a route edit can move the boundary or clear a date, and a field
        // that no longer qualifies shouldn't stay marked.
        document.querySelectorAll("input[data-tt-manual-etd]").forEach(f => this.clearHighlight(f));

        const stopRow = PortSyncBoundary.getStopRow();
        if (!stopRow) return; // route never loops back — nothing is "past the boundary"

        document.querySelectorAll('input[name^="SP"][name$="_depart_date"]:not([name^="PV_"])').forEach(field => {
            const match = field.name.match(/^SP(\d+)_depart_date$/);
            if (!match) return;

            const row = parseInt(match[1], 10);
            if (row <= stopRow) return;      // still within the synced range
            if (!field.value.trim()) return; // nothing entered, nothing to flag

            this.applyHighlight(field);
        });
    },

    init() {
        this.run();
    },

    // Re-run whenever a port code changes (the boundary itself can shift)
    // or any depart/arrival date changes.
    handle(event) {
        const { name } = event.target;
        if (!name) return;

        const relevant =
            /^SP\d+_port_code$/.test(name) ||
            /^SP\d+_depart_date$/.test(name) ||
            /^SP\d+_arrival_date$/.test(name);

        if (!relevant) return;
        this.run();
    }
};
