// ─────────────────────────────────────────────────────
//  FEATURE: Schedule Capture
//  Reads a service's port/vessel rows straight off Tradetech's
//  schedule_detailsB.pl edit page (SP*/SV* fields, already
//  filled in by whoever entered that service) and relays a
//  snapshot to the local server, which keeps it as the one
//  active "guideline" — used to cross-check extracted proof
//  data. Reads Tradetech's own DOM values only; nothing is
//  fetched from any external site. Only runs on that one page —
//  everywhere else on Tradetech, this feature does nothing.
// ─────────────────────────────────────────────────────
const ScheduleCapture = {

    ws: null,
    _socketClient: null,
    _sendTimer: null,

    isSchedulePage() {
        return location.href.includes("schedule_detailsB.pl");
    },

    init() {
        if (!this.isSchedulePage()) return;
        this.connect();
        setTimeout(() => this.sendSnapshot(), 1000);
    },

    connect() {
        this._socketClient = connectRelaySocket({
            onSocket: (socket) => { this.ws = socket; },
            onOpen: () => this.sendSnapshot()
        });
    },

    readPorts() {
        const codeFields = document.querySelectorAll(
            'input[name^="SP"][name$="_port_code"]:not([name^="PV_"])'
        );
        const ports = [];

        codeFields.forEach(codeField => {
            const match = codeField.name.match(/^SP(\d+)_port_code$/);
            if (!match) return;
            const row  = match[1];
            const code = codeField.value.trim();
            if (!code) return;

            const nameField    = PortRow.field(row, "port_name");
            const arrivalField = PortRow.field(row, "arrival_date");
            const departField  = PortRow.field(row, "depart_date");

            ports.push({
                row,
                code,
                name:    nameField?.value.trim() || "",
                arrival: arrivalField?.value.trim() || "",
                depart:  departField?.value.trim() || ""
            });
        });

        return ports;
    },

    readVessels() {
        const nameFields = document.querySelectorAll(
            'input[name^="SV"][name$="_vessel_name"]:not([name^="PV_"])'
        );
        const vessels = [];

        nameFields.forEach(nameField => {
            const match = nameField.name.match(/^SV(\d+)_vessel_name$/);
            if (!match) return;
            const row  = match[1];
            const name = nameField.value.trim();
            if (!name) return;

            const voyageField = VesselRow.field(row, "start_voyage");
            const departField = VesselRow.field(row, "depart_date");
            const codeField   = VesselRow.field(row, "lloyds_codeD");
            const imo         = codeField?.value.trim() || "";

            vessels.push({
                row,
                name,
                voyage: voyageField?.value.trim() || "",
                depart: departField?.value.trim() || "",
                // Lloyds/IMO code -- canonical identity (see
                // duplicate-vessel.js), lets the backend match this
                // vessel exactly instead of falling back to name/
                // dictionary matching alone.
                imo,
                // "VESSEL TO BE ANNOUNCED" (vessel-to-be-announced.js's
                // backtick shortcut) is a deliberate placeholder, not a
                // real vessel identity -- flagged so the backend doesn't
                // treat it as an expected vessel that's "missing from
                // proof" forever, since it can never resolve.
                isPlaceholder: name === "VESSEL TO BE ANNOUNCED"
            });
        });

        return vessels;
    },

    // Tradetech's own priority hint for which port marks a region entry —
    // same fields PortHighlighting.js's priority pass checks client-side.
    readFirstPorts() {
        const usField = document.querySelector('input[name="first_us_port"]');
        const euField = document.querySelector('input[name="first_eu_port"]');
        return {
            firstUsPort: usField?.value.trim() || "",
            firstEuPort: euField?.value.trim() || "",
        };
    },

    // PortHighlighting.run() already picked the anchor port live on this
    // page — send along which one, for whatever server-side feature
    // wants a ground-truth anchor port later.
    readHighlightedPort() {
        const field = PortHighlighting.currentHighlightField;
        if (!field) return null;

        const match = field.name.match(/^SP(\d+)_port_name$/);
        if (!match) return null;

        const row  = match[1];
        const code = PortRow.field(row, "port_code")?.value.trim() || "";

        return { row, code, name: field.value.trim() };
    },

    sendSnapshot() {
        const serviceField = document.querySelector('input[name="service"]');
        const service = serviceField?.value.trim();
        if (!service) return;

        const operatorField = document.querySelector('input[name="vessel_operator"]');
        const operator = operatorField?.value.trim() || "";

        const ports   = this.readPorts();
        const vessels = this.readVessels();
        if (ports.length === 0 && vessels.length === 0) return;

        const { firstUsPort, firstEuPort } = this.readFirstPorts();
        const highlightedPort = this.readHighlightedPort();

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: "schedule-snapshot", service, operator, ports, vessels, firstUsPort, firstEuPort, highlightedPort }));
            console.log(`📤 Schedule snapshot sent: ${service} (${ports.length} port row(s), ${vessels.length} vessel row(s))`);
        }
    },

    // Re-send whenever a relevant field changes, debounced so a burst
    // of edits (e.g. RearrangeVessels touching many rows at once)
    // collapses into one snapshot instead of one per field.
    handle(event) {
        if (!this.isSchedulePage()) return;

        const name = event.target?.name;
        if (!name || name.startsWith("PV_")) return;

        const relevant =
            name === "service" ||
            name === "vessel_operator" ||
            name === "first_us_port" ||
            name === "first_eu_port" ||
            /^SP\d+_port_(code|name|arrival_date|depart_date)$/.test(name) ||
            /^SV\d+_(vessel_name|start_voyage|depart_date)$/.test(name);

        if (!relevant) return;

        clearTimeout(this._sendTimer);
        this._sendTimer = setTimeout(() => this.sendSnapshot(), 800);
    },

    handleBlur(_event) {}
};
