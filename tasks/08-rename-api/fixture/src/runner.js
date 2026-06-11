const { compute } = require("./calculate.js");

function runAll(pairs) {
  return pairs.map(([a, b]) => compute(a, b));
}
module.exports = { runAll };
