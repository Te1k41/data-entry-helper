// Canonical adapter for Tradetech's SV rows. Identity remains Lloyds/IMO
// (lloyds_codeD); occupancy is deliberately broader and treats any entered
// code, name, voyage, or date as real row content.
const VesselRow = {
    FIELD_SUFFIXES: ["lloyds_codeD", "lloyds_code", "vessel_name", "start_voyage", "depart_date"],

    field(row, suffix) {
        return document.querySelector(`input[name="SV${row}_${suffix}"]:not([name^="PV_"])`);
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

            if (suffix === "depart_date") setFieldValue(field, values[suffix]);
            else field.value = values[suffix];

            const pvField = document.querySelector(`input[name="PV_${field.name}"]`);
            if (pvField) pvField.value = field.value;
        });
    },

    isOccupied(row) {
        const values = typeof row === "object" ? row : this.read(row);
        return [values.lloyds_codeD, values.vessel_name, values.start_voyage, values.depart_date]
            .some(value => String(value || "").trim());
    },

    isEmpty(row) {
        return !this.isOccupied(row);
    }
};
