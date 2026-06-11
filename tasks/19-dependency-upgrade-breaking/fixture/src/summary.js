const { format } = require('../vendor/jsonfmt');

// summary renders a record as COMPACT (single-line) JSON.
// v1-style call sites below pass NO opts and must be migrated for jsonfmt v2.
function summary(obj) {
  return format(obj);
}

function summaryWrapped(obj) {
  return format({ wrapped: obj });
}

module.exports = { summary, summaryWrapped };
