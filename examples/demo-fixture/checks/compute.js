// Gate for the `compute` node. Exits 0 only if src/sum.js exports a working
// sum(a, b). Lives outside the node blast_radius.
const path = require("node:path");
try {
  const mod = require(path.join(__dirname, "..", "src", "sum.js"));
  const sum = mod && mod.sum;
  process.exit(typeof sum === "function" && sum(2, 3) === 5 && sum(-1, 1) === 0 ? 0 : 1);
} catch {
  process.exit(1);
}
