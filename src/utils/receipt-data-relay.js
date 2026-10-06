// ============================================================
//  src/utils/receipt-data-relay.js
//  Makes a rotation receipt PNG carry its own route data, so the Route
//  Map app can redraw the route from the receipt file alone (a PNG is
//  otherwise just pixels — no port codes to look coordinates up by).
//
//  The data rides in a PNG tEXt chunk named "TTHelper-Receipt" (base64
//  of UTF-8 JSON — tEXt itself is Latin-1 only). Invisible: the image,
//  and so its height (which Highlight Review reads a receipt's row count
//  from), are unchanged.
//
//  Private-only for now (-relay.js, stripped from the community build):
//  save-confirmation.js only calls into this when it's loaded.
//
//  Shape (v1):
//    { v, capturedAt, service, vesselOperator: { code, name },
//      carriers: [{ code, name, service }],
//      ports: [{ row, code, name, key, arrival, depart }],
//      highlightedRow }
// ============================================================

const ReceiptData = {
    KEYWORD: "TTHelper-Receipt",

    // Everything the Route Map needs, read straight off the edit form.
    fromForm(formDoc, highlightedRow = null) {
        const read = name => formDoc.querySelector(`input[name="${name}"]`)?.value.trim() || "";

        // SC01_carrier_code / _name / _service, SC02_…, one per carrier
        // row (confirmed from the live form's markup).
        const carriers = Array.from(formDoc.querySelectorAll('input[name^="SC"][name$="_carrier_code"]'))
            .map(codeField => {
                const prefix = codeField.name.replace(/_carrier_code$/, "");
                return { code: codeField.value.trim(), name: read(`${prefix}_carrier_name`), service: read(`${prefix}_carrier_service`) };
            })
            .filter(c => c.code || c.name);

        // The form only holds the operator's CODE for sure; its full name
        // comes from a _desc field if Tradetech has one, else from the
        // carrier row with the same code (the operator is normally one
        // of the service's carriers).
        const opCode = read("vessel_operator");
        const opName = read("vessel_operator_desc") || carriers.find(c => c.code === opCode)?.name || "";

        return {
            v: 1,
            capturedAt: new Date().toISOString(),
            service: read("service"),
            vesselOperator: { code: opCode, name: opName },
            carriers,
            ports: SaveConfirmation.buildRotationRows(formDoc)
                .map(({ row, code, name, key, arrival, depart }) => ({ row, code, name, key, arrival, depart })),
            highlightedRow,
        };
    },

    // PNG bytes + data -> new PNG bytes with the tEXt chunk inserted
    // right before IEND.
    embed(pngBytes, data) {
        const bytes = new Uint8Array(pngBytes);
        const iend = bytes.length - 12; // IEND is always the last 12 bytes
        const text = new TextEncoder().encode(`${this.KEYWORD}\0${this._toBase64(new TextEncoder().encode(JSON.stringify(data)))}`);
        const chunk = this._chunk("tEXt", text);
        const out = new Uint8Array(bytes.length + chunk.length);
        out.set(bytes.subarray(0, iend), 0);
        out.set(chunk, iend);
        out.set(bytes.subarray(iend), iend + chunk.length);
        return out;
    },

    // PNG bytes -> data object, or null when the receipt predates this
    // (or isn't one of ours).
    extract(pngBytes) {
        const bytes = new Uint8Array(pngBytes);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let pos = 8; pos + 12 <= bytes.length;) {
            const len  = view.getUint32(pos);
            const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
            if (type === "tEXt") {
                const body = bytes.subarray(pos + 8, pos + 8 + len);
                const sep = body.indexOf(0);
                if (new TextDecoder("latin1").decode(body.subarray(0, sep)) === this.KEYWORD) {
                    const b64 = new TextDecoder("latin1").decode(body.subarray(sep + 1));
                    try { return JSON.parse(new TextDecoder().decode(this._fromBase64(b64))); } catch (e) { return null; }
                }
            }
            if (type === "IEND") break;
            pos += 12 + len;
        }
        return null;
    },

    async embedBlob(blob, data) {
        return new Blob([this.embed(await blob.arrayBuffer(), data)], { type: "image/png" });
    },

    embedDataUrl(dataUrl, data) {
        const bytes = this._fromBase64(dataUrl.slice(dataUrl.indexOf(",") + 1));
        return `data:image/png;base64,${this._toBase64(this.embed(bytes, data))}`;
    },

    _chunk(type, data) {
        const out = new Uint8Array(12 + data.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, data.length);
        for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
        out.set(data, 8);
        view.setUint32(8 + data.length, this._crc32(out.subarray(4, 8 + data.length)));
        return out;
    },

    _crc32(bytes) {
        if (!this._crcTable) {
            this._crcTable = Array.from({ length: 256 }, (_, n) => {
                let c = n;
                for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                return c >>> 0;
            });
        }
        let c = 0xffffffff;
        for (const b of bytes) c = this._crcTable[(c ^ b) & 255] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    },

    _toBase64(bytes) {
        let s = "";
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
    },

    _fromBase64(b64) {
        return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    },
};
