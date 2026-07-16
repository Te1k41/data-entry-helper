// ─────────────────────────────────────────────────────
//  FEATURE: Due Service Scanner
//  Once you land on the search page (either on your own,
//  or via AutoNavSchedules clicking through from login),
//  automatically fills Assigned To with your name and runs
//  the search — date fields are left untouched, at
//  Tradetech's own default. The parsed result is posted
//  straight to the relay server as-is. Deciding how many
//  services actually get kept (and which ones) is the
//  SERVER's job — see service-relay/due-services-trim.js —
//  not the extension's, so that logic can be tuned without
//  redeploying this file. Runs at most once per browser tab
//  session.
//
//  NOTE: this feature was built from a pasted HTML sample
//  of the results table and the two filter fields, not a
//  live look at the whole search page. The Search button
//  itself is confirmed (plain <input type="submit">), but
//  double-check that s_assignedTo lives in the SAME <form>
//  as that button.
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
//  FEATURE: Due Service Scanner
//  Once you land on the search page (either on your own,
//  or via AutoNavSchedules clicking through from login),
//  automatically fills Assigned To with your name and runs
//  the search — date fields are left untouched, at
//  Tradetech's own default. The parsed result is posted
//  straight to the relay server as-is. Deciding how many
//  services actually get kept (and which ones) is the
//  SERVER's job — see service-relay/due-services-trim.js —
//  not the extension's, so that logic can be tuned without
//  redeploying this file.
//
//  The WHOLE routine — search, scan, and post — only happens
//  ONCE PER CALENDAR DAY now (tracked via localStorage, not
//  sessionStorage — so it persists across new tabs, not just
//  within one tab's session). Opening 5 new tabs today won't
//  re-run any of it 5 times; tomorrow it auto-fires again.
//  The "🔄 Scan & Save" button always works regardless, as a
//  manual override.
//
//  NOTE: this feature was built from a pasted HTML sample
//  of the results table and the two filter fields, not a
//  live look at the whole search page. The Search button
//  itself is confirmed (plain <input type="submit">), but
//  double-check that s_assignedTo lives in the SAME <form>
//  as that button.
// ─────────────────────────────────────────────────────

const DueServiceScanner = {

    FLAG_AUTO_SEARCH_RUN: "tt_dueScanAutoSearchRun", // sessionStorage — per TAB, avoids re-searching on every reload within the same tab
    FLAG_LAST_AUTO_SCAN_DATE: "tt_dueScan_lastAutoScanDate", // localStorage — per CALENDAR DAY, shared across all tabs

    todayDateString() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },

    hasAutoScannedToday() {
        return localStorage.getItem(this.FLAG_LAST_AUTO_SCAN_DATE) === this.todayDateString();
    },

    markAutoScannedToday() {
        localStorage.setItem(this.FLAG_LAST_AUTO_SCAN_DATE, this.todayDateString());
    },

    init() {
        const onResultsPage = !!document.querySelector('input[name$="_REC"]');
        const onSearchPage  = !!document.querySelector('input[name="s_next_update_datet"]');

        // The WHOLE routine (search + scan + post) only runs once per
        // calendar day now — not once per tab. If today's already
        // done, don't even auto-fill/search again in a new tab.
        if (onSearchPage && !this.hasAutoScannedToday() && !sessionStorage.getItem(this.FLAG_AUTO_SEARCH_RUN)) {
            sessionStorage.setItem(this.FLAG_AUTO_SEARCH_RUN, "1");
            this.fillAssignedToAndSearch();
        }

        // The SCAN+POST itself only runs once per calendar day — this is
        // the meaningful, once-daily action (searching alone doesn't
        // accomplish anything without it). Landing on a results page
        // again later the same day (new tab, manual browsing, etc.)
        // won't re-trigger it; tomorrow it's live again automatically.
        if (onResultsPage) {
            this.createScanButton();

            if (!this.hasAutoScannedToday()) {
                this.scanAndReport();
            } else {
                console.log(`📅 Already auto-scanned today (${this.todayDateString()}) — use "🔄 Scan & Save" to re-scan manually`);
            }
        }
    },

    createScanButton() {
        Toolbar.register({
            id:      "tt-due-scan-save",
            label:   "🔄 Scan & Save",
            onClick: () => this.scanAndReport()
        });
    },

    // Reads your Tradetech username from the relay's settings — set
    // once at http://localhost:3737/settings-page instead of being
    // hardcoded here. If the relay isn't reachable or nothing's been
    // configured yet, leaves the field for you to fill in by hand
    // rather than silently failing.
    //
    // Fires change/input/blur (not just change) and does a real
    // focus()+blur() cycle, since dispatching a single synthetic
    // "change" event wasn't reliably triggering Tradetech's own
    // valid_sql() AJAX lookup that resolves the hidden
    // s_assignedToId field — mimicking real typing + tabbing away
    // is more robust against whatever exact event Tradetech's script
    // actually listens for.
    async fillAssignedToAndSearch() {
        const assignedField = document.querySelector('input[name="s_assignedTo"]');

        if (assignedField && !assignedField.value.trim()) {
            try {
                const res = await fetch("http://localhost:3737/settings");
                const settings = await res.json();

                if (settings.assignedToName) {
                    assignedField.focus();
                    assignedField.value = settings.assignedToName;
                    assignedField.dispatchEvent(new Event("input",  { bubbles: true }));
                    assignedField.dispatchEvent(new Event("change", { bubbles: true }));
                    assignedField.blur();
                    assignedField.dispatchEvent(new Event("blur", { bubbles: true }));
                    console.log(`👤 Auto-filled Assigned To: ${settings.assignedToName}`);
                } else {
                    console.warn("⚠ No Tradetech username set yet — visit http://localhost:3737/settings-page");
                }
            } catch (err) {
                console.warn("⚠ Could not reach relay for settings — fill in Assigned To manually:", err.message);
            }
        }

        this.runSearch();
    },

    // Filters by Assigned To ONLY — the date fields are left completely
    // untouched, at whatever Tradetech's own default is. This is a
    // DELIBERATE narrower scope: an earlier version tried to force
    // "search everything" via a fake far-future date, which worked but
    // added real complexity. Confirmed OK to accept Tradetech's default
    // date scope instead (the batch system server-side will simply work
    // from whatever comes back, rather than assuming the full list).
    runSearch() {
        const assignedField   = document.querySelector('input[name="s_assignedTo"]');
        // valid_sql()'s onchange/blur handler on s_assignedTo does an
        // async lookup and writes the RESOLVED id here — this, not the
        // visible text, is what the search actually filters by (per
        // fldS3/'s_assignedToId' in the field's onchange attribute).
        const assignedIdField = document.querySelector('input[name="s_assignedToId"]');

        console.log("🔎 Searching by Assigned To only — date fields left at Tradetech's own default");

        this.waitForFieldsThenSubmit({ assignedField, assignedIdField });
    },

    // Polls (every 150ms, up to ~8s — a real network round trip for
    // Tradetech's own AJAX lookup, not a same-tick DOM update) until
    // the ASSIGNED TO NAME is actually confirmed registered — i.e. the
    // hidden s_assignedToId field has a resolved value, not just that
    // the visible text box looks non-blank. Without this, the search
    // could fire before valid_sql()'s lookup finishes, silently
    // ignoring the Assigned To filter entirely.
    waitForFieldsThenSubmit({ assignedField, assignedIdField }) {
        let attempts = 0;
        const maxAttempts = 54; // 54 × 150ms ≈ 8s ceiling

        const nameConfirmed = () =>
            !assignedField || assignedField.value.trim().length === 0 ||
            (assignedIdField && assignedIdField.value.trim().length > 0);

        const timer = setInterval(() => {
            attempts++;

            if (nameConfirmed()) {
                clearInterval(timer);
                console.log("✅ Assigned To name confirmed registered by Tradetech — submitting search");
                this.submitSearch(assignedField);
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(timer);
                console.warn(
                    "⚠ Tradetech never registered the Assigned To name after 8s " +
                    `(s_assignedToId=${assignedIdField?.value || "empty"}) — submitting anyway`
                );
                this.submitSearch(assignedField);
            }

        }, 150);
    },

    // Tradetech's pages here use onclick-driven JS rather than native
    // form submission everywhere else in this project, so a real
    // "Search"/"Submit" button most likely needs to be clicked rather
    // than calling form.submit() directly.
    submitSearch(fieldInsideForm) {
        const searchBtn = document.querySelector(
            'input[type="button"][value*="Search" i], ' +
            'input[type="submit"][value*="Search" i], ' +
            'button[value*="Search" i]'
        );

        if (searchBtn) {
            searchBtn.click();
            return;
        }

        const form = fieldInsideForm.closest("form");
        if (form) {
            console.warn("⚠ No obvious Search button found — falling back to form.submit()");
            form.submit();
        } else {
            console.error("❌ Due Service Scanner: could not find a Search button or a parent form");
        }
    },

    // Parses the results table using the exact column order from the
    // sample page: [#, Record, Edit, Preview, Data Tracking, Proof Log,
    // Service, Vessel Operator, Assigned To, Created, Active?,
    // Last Updated, Proofed, Next Update Date, Expire Date, ...].
    // Posts the FULL parsed list as-is — no trimming here, the relay
    // server decides how many/which services actually get kept.
    scanAndReport() {
        const recordInputs = document.querySelectorAll('input[name$="_REC"]');
        const services = [];

        recordInputs.forEach(hidden => {
            const row = hidden.closest("tr");
            if (!row) return;

            const cells = row.querySelectorAll("td");
            if (cells.length < 14) return; // not the row shape we expect

            const record         = cells[1]?.textContent.trim();
            const service        = cells[6]?.textContent.trim();
            const carrier        = cells[7]?.textContent.trim();
            const assignedTo     = cells[8]?.textContent.trim();
            const nextUpdateDate = cells[13]?.textContent.trim();

            if (record && service) {
                services.push({ record, service, carrier, assignedTo, nextUpdateDate });
            }
        });

        console.log(`📋 Due Service Scanner: parsed ${services.length} total assigned service(s) — posting as-is`);

        // Mark today as auto-scanned BEFORE posting — this is what stops
        // any other tab (today or later today) from auto-scanning again.
        // Manual re-scans still always work via the "🔄 Scan & Save"
        // button, regardless of this flag.
        this.markAutoScannedToday();

        fetch("http://localhost:3737/due-services", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ services })
        })
        .then(res => res.json())
        .then(data => console.log(`✅ Posted — relay kept ${data.count} service(s) after its own trimming — view at http://localhost:3737/dashboard`))
        .catch(err => console.error("❌ Could not reach relay server:", err));
    },

    handle(_event)     {},
    handleBlur(_event) {}
};