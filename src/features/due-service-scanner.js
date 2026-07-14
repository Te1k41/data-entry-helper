// ─────────────────────────────────────────────────────
//  FEATURE: Due Service Scanner
//  Once you land on the search page (either on your own,
//  or via AutoNavSchedules clicking through from login),
//  automatically fills Assigned To with your name and runs
//  the search with NO date filter — every service assigned
//  to you comes back, not just a "due soon" slice. The full,
//  UNTRIMMED result is parsed and posted straight to the
//  relay server as-is. Deciding how many services actually
//  get kept (and which ones) is the SERVER's job — see
//  service-relay/due-services-trim.js — not the extension's,
//  so that logic can be tuned without redeploying this file.
//  Runs at most once per browser tab session.
//
//  NOTE: this feature was built from a pasted HTML sample
//  of the results table and the two filter fields, not a
//  live look at the whole search page. The Search button
//  itself is confirmed (plain <input type="submit">), but
//  double-check that s_assignedTo / s_next_update_datet
//  live in the SAME <form> as that button.
// ─────────────────────────────────────────────────────

const DueServiceScanner = {

    ASSIGNED_TO_NAME: "tienduongTTI",

    FLAG_AUTO_SEARCH_RUN: "tt_dueScanAutoSearchRun",
    FLAG_AUTO_SCAN_DONE:  "tt_dueScanAutoScanDone",

    init() {
        const onResultsPage = !!document.querySelector('input[name$="_REC"]');
        const onSearchPage  = !!document.querySelector('input[name="s_next_update_datet"]');

        if (onSearchPage && !sessionStorage.getItem(this.FLAG_AUTO_SEARCH_RUN)) {
            sessionStorage.setItem(this.FLAG_AUTO_SEARCH_RUN, "1");
            this.fillAssignedToAndSearch();
        }

        // Auto-scan happens ONCE per tab session (the very first time we
        // land on a results page — normally right after our own auto-run
        // search above). After that, landing on results pages again
        // (browsing manually, revisiting, etc.) does NOT keep re-scanning
        // and re-posting on its own — that's now a deliberate action via
        // the "🔄 Scan & Save" button instead.
        if (onResultsPage) {
            this.createScanButton();

            if (!sessionStorage.getItem(this.FLAG_AUTO_SCAN_DONE)) {
                this.scanAndReport();
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

    fillAssignedToAndSearch() {
        const assignedField = document.querySelector('input[name="s_assignedTo"]');
        if (assignedField && !assignedField.value.trim()) {
            assignedField.value = this.ASSIGNED_TO_NAME;
            assignedField.dispatchEvent(new Event("change", { bubbles: true }));
            console.log(`👤 Auto-filled Assigned To: ${this.ASSIGNED_TO_NAME}`);
        }

        this.runSearch();
    },

    // Blanking the date field turned out NOT to mean "no filter" —
    // Tradetech apparently falls back to showing just the nearest single
    // day's services when the field is empty (confirmed: blank returned
    // exactly the nearest day's count, nothing more). Instead, we set an
    // explicit "On or Before" filter with a date far enough in the
    // future (10 years out) that it functionally includes every
    // service, without relying on blank-field behavior Tradetech
    // doesn't actually support the way we assumed.
    runSearch() {
        const opSelect      = document.querySelector('select[name="s_next_update_datet_s"]');
        const dateInput     = document.querySelector('input[name="s_next_update_datet"]');
        const assignedField = document.querySelector('input[name="s_assignedTo"]');
        // valid_sql()'s onchange handler on s_assignedTo does an async lookup
        // and writes the RESOLVED id here — this, not the visible text, is
        // what the search actually filters by (per fldS3/'s_assignedToId'
        // in the field's onchange attribute).
        const assignedIdField = document.querySelector('input[name="s_assignedToId"]');

        if (!opSelect || !dateInput) {
            console.warn("⚠ Due Service Scanner: filter fields not found on this page");
            return;
        }

        const farFuture = new Date();
        farFuture.setFullYear(farFuture.getFullYear() + 10);
        const mm = String(farFuture.getMonth() + 1).padStart(2, "0");
        const dd = String(farFuture.getDate()).padStart(2, "0");
        const yy = String(farFuture.getFullYear()).slice(-2);
        const expectedDate = `${mm}/${dd}/${yy}`;

        opSelect.value  = ":le:"; // "On or Before"
        dateInput.value = expectedDate;

        opSelect.dispatchEvent(new Event("change", { bubbles: true }));
        dateInput.dispatchEvent(new Event("change", { bubbles: true }));

        console.log(`🔎 Searching ALL services assigned to me (on or before ${expectedDate}, effectively everything)`);

        this.waitForFieldsThenSubmit({ opSelect, dateInput, assignedField, assignedIdField, expectedDate });
    },

    // Polls the filter fields (every 150ms, up to ~5s — a bit longer than
    // a same-tick DOM update, since the assignedToId lookup is a real
    // network round trip) until each one actually holds the expected
    // value. Crucially, this doesn't just check that the visible
    // s_assignedTo TEXT is non-blank — it waits for the async-resolved
    // s_assignedToId hidden field too, since that's what actually drives
    // the search filter. Without this, the search could fire before
    // valid_sql()'s lookup finishes, silently ignoring the Assigned To
    // filter entirely (which matches what was seen manually: typing the
    // name alone didn't filter anything until Tab caused enough of a
    // delay for the lookup to complete on its own).
    waitForFieldsThenSubmit({ opSelect, dateInput, assignedField, assignedIdField, expectedDate }) {
        let attempts = 0;
        const maxAttempts = 34; // 34 × 150ms ≈ 5s ceiling

        const allFieldsReady = () =>
            opSelect.value === ":le:" &&
            dateInput.value.trim() === expectedDate &&
            (!assignedField || assignedField.value.trim().length === 0 ||
                (assignedIdField && assignedIdField.value.trim().length > 0));

        const timer = setInterval(() => {
            attempts++;

            if (allFieldsReady()) {
                clearInterval(timer);
                console.log("✅ All filter fields confirmed (incl. resolved Assigned To id) — submitting search");
                this.submitSearch(dateInput);
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(timer);
                console.warn(
                    "⚠ Fields never fully confirmed after 5s " +
                    `(assignedToId=${assignedIdField?.value || "empty"}) — submitting anyway`
                );
                this.submitSearch(dateInput);
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

        // Mark the auto-scan flow as finalized BEFORE posting — this is
        // what stops future results-page visits from auto-scanning
        // again. Manual re-scans after this point only happen via the
        // "🔄 Scan & Save" button.
        sessionStorage.setItem(this.FLAG_AUTO_SCAN_DONE, "1");

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