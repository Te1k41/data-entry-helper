// ============================================================
//  proof-parsers/index.js — operator code → parser registry
//  Keyed by carrier/vessel-operator code (e.g. "MSK"), not
//  service code — the same carrier presents its schedule the
//  same way across every service it runs, so the operator code
//  (captured off Tradetech's own vessel_operator field) is what
//  tells the tool which parsing rules to use. Add one as:
//  registry.MSK = require("./msk"); Until then, everything
//  falls back to the generic header-matching parser in default.js.
// ============================================================

const defaultParser = require("./default");

const registry = {
    ONE: require("./one"),
    OOC: require("./oocl"),
    EVG: require("./evergreen"),
};

function getParser(operator) {
    return registry[operator] || defaultParser;
}

module.exports = { getParser };
