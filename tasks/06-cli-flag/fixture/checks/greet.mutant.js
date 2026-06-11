const { parseArgs } = require("./args.js");
function run(argv) { const { name } = parseArgs(argv); return `Hello, ${name}!`; } // MUTANT: ignores shout
module.exports = { run };
