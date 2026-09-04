// Canonical adapter for Tradetech's SP rows. Plain fields are relocated
// without replaying async validation; date writes still go through
// setFieldValue so Tradetech recomputes its derived date fields.
const PortRow = {
    FIELD_SUFFIXES: [
        "port_code", "port_name",
        "locationCode", "locationName", "knownEntityLocationId",
        "port_key", "arrival_date", "depart_date"
    ],

    field(row, suffix) {
        return document.querySelector(`input[name="SP${row}_${suffix}"]:not([name^="PV_"])`);
    },

    read(row) {
        const values = { row };
        this.FIELD_SUFFIXES.forEach(suffix => {
            const field = this.field(row, suffix);
            values[suffix] = field ? field.value : null;
        });
        return values;
    },

    write(row, values) {
        this.FIELD_SUFFIXES.forEach(suffix => {
            const field = this.field(row, suffix);
            if (!field || values[suffix] === null || values[suffix] === undefined) return;

            if (suffix === "arrival_date" || suffix === "depart_date") {
                setFieldValue(field, values[suffix]);
            } else {
                field.value = values[suffix];
                const pvField = document.querySelector(`input[name="PV_${field.name}"]`);
                if (pvField) pvField.value = values[suffix];
            }
        });
    },

    blank(row) {
        const values = { row };
        this.FIELD_SUFFIXES.forEach(suffix => { values[suffix] = ""; });
        return values;
    },

    isOccupied(row) {
        const values = typeof row === "object" ? row : this.read(row);
        return [values.port_code, values.port_name, values.arrival_date, values.depart_date]
            .some(value => String(value || "").trim());
    },

    isEmpty(row) {
        return !this.isOccupied(row);
    }
};
