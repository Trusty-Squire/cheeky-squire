// MUTANT of packages/app/src/cli.js: drops the bound() score from the output.
// A real test asserting the full "<Title> scored <N>" string must catch this.
const { greet } = require("./greeting.js");
const { bound } = require("./bound.js");
function run(argv) {
  let name = "";
  let score = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") name = argv[++i];
    else if (argv[i] === "--score") score = Number(argv[++i]);
  }
  void bound;
  void score;
  return `${greet(name).title} scored`; // MUTANT: omits the bounded score
}
module.exports = { run };
