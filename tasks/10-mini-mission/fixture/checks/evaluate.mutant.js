const ops = require("./ops.js");
function evaluate(op, a, b) { return ops.add(a, b); } // MUTANT: ignores op, always adds
module.exports = { evaluate };
