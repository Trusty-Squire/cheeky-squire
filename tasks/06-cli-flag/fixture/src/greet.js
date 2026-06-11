const { parseArgs } = require("./args.js");

function run(argv) {
  const { name } = parseArgs(argv);
  return `Hello, ${name}!`;
}
module.exports = { run };
