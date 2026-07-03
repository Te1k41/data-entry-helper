const PortSyncBoundary = {
    // Scans SP*_port_code fields top-to-bottom.
    // Returns the row number of the FIRST repeat of the opening port,
    // or null if the opening port never repeats.
    //
    // Example: HKG → SHA → HKG  → returns 3  (row of the second HKG)
    // Example: HKG → SHA → SHA  → returns null (SHA is not the first port)
    getStopRow() {
        const portFields = document.querySelectorAll(
            'input[name^="SP"][name$="_port_code"]:not([name^="PV_"])'
        );

        let firstPort = null;

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
                console.log(`🔁 First port ${port} repeated at SP${String(row).padStart(3, "0")}`);
                return row;
            }
        }

        return null;
    },

    // Returns true if this SP row's date sync should be skipped.
    shouldBlock(spRow) {
        const stopRow = this.getStopRow();
        if (!stopRow) return false;
        return spRow > stopRow;
    }
};