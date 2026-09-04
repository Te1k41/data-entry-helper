// Shared bounded JSON request reader. Route handlers remain responsible for
// translating failures into their existing endpoint-specific response shape.
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function requestError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function readJsonBody(req, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    return new Promise((resolve, reject) => {
        let body = "";
        let bytes = 0;
        let settled = false;

        req.on("data", chunk => {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > maxBytes) {
                settled = true;
                req.removeAllListeners("data");
                req.resume();
                const limit = maxBytes === DEFAULT_MAX_BYTES ? "5 MB" : `${maxBytes} byte`;
                reject(requestError(`request body exceeds the ${limit} limit`, 413));
                return;
            }
            body += chunk;
        });

        req.on("end", () => {
            if (settled) return;
            settled = true;
            if (!body.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(requestError(`malformed JSON body: ${err.message}`, 400));
            }
        });

        req.on("error", err => {
            if (settled) return;
            settled = true;
            reject(err);
        });
    });
}

module.exports = { readJsonBody, requestError };
