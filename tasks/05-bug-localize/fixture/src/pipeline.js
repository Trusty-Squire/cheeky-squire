const { parse } = require("./parse.js");
const { transform } = require("./transform.js");
const { format } = require("./format.js");

// run("1,2,3") -> parse -> transform (double) -> format -> "2-4-6"
function run(input) {
  return format(transform(parse(input)));
}
module.exports = { run };
