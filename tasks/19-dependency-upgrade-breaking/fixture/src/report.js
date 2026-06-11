const { format } = require('../vendor/jsonfmt');

// report renders a record as PRETTY (2-space indented) JSON.
// v1-style call sites below pass NO opts and must be migrated for jsonfmt v2.
function report(obj) {
  return format(obj);
}

function reportWrapped(obj) {
  return format({ wrapped: obj });
}

module.exports = { report, reportWrapped };
