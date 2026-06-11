// Parse a comma-separated list of integers.
function parse(input) {
  return input.split(",").map((s) => Number(s.trim()));
}
module.exports = { parse };
