const PortSyncBoundary = {
    // Directional (one bound) = the route loops back to the port it started
    // from. Either signal is enough:
    //  - the service code ends in a single letter ("AE1-E", "ABC-A"), or
    //  - SP001_port_key is blank or has any non-letter character ("*", "E1"…).
    //    A full-bound service carries a real compass key there ("ES", "EEWS").
    // Anything else is a full-bound (two-bound) service. The one shared
    // definition — port-highlighting.js reuses it.
    isDirectionalService() {
        const serviceField = document.querySelector('input[type="text"][name="service"]');
        if (/-[A-Z]$/i.test(serviceField ? serviceField.value.trim() : "")) return true;

        const keyField = document.querySelector('input[type="text"][name="SP001_port_key"]');
        return !!keyField && !/^[A-Za-z]+$/.test(keyField.value.trim());
    },

    // Scans SP*_port_code fields top-to-bottom for repeats of the opening
    // port and returns the row where the route's loop ends, or null if the
    // opening port never repeats.
    //
    // Non-directional: the FIRST repeat — everything after it is the
    // repeated "return leg".
    // Directional: the LAST repeat. The opening port can reappear several
    // times mid-route before the loop actually closes (SIN, HKG, SIN, LAX,
    // OAK, SIN), so stopping at the first one would treat the real route's
    // remaining ports as "past the boundary" (skipping their date sync and
    // flagging their dates as hand-typed).
    //
    // Example: HKG → SHA → HKG  → returns 3  (row of the second HKG)
    // Example: HKG → SHA → SHA  → returns null (SHA is not the first port)
    getStopRow() {
        const portFields = document.querySelectorAll(
            'input[name^="SP"][name$="_port_code"]:not([name^="PV_"])'
        );
        const directional = this.isDirectionalService();

        let firstPort = null;
        let lastRepeatRow = null;

        for (const field of portFields) {
            const port = field.value.trim().toUpperCase();
            if (!port) continue;

            const match = field.name.match(/^SP(\d+)_port_code$/);
            if (!match) continue;
            const row = parseInt(match[1], 10);

            if (firstPort === null) {
                firstPort = port;
                continue;
            }

            if (port === firstPort) {
                if (!directional) {
                    console.log(`🔁 First port ${port} repeated at SP${String(row).padStart(3, "0")}`);
                    return row;
                }
                lastRepeatRow = row; // keep scanning — the LAST repeat is the real loop closure
            }
        }

        if (lastRepeatRow) {
            console.log(`🔁 Directional service — first port ${firstPort} last repeated at SP${String(lastRepeatRow).padStart(3, "0")}`);
        }
        return lastRepeatRow;
    },

    // Returns true if this SP row's date sync should be skipped.
    shouldBlock(spRow) {
        const stopRow = this.getStopRow();
        if (!stopRow) return false;
        return spRow > stopRow;
    }
};
