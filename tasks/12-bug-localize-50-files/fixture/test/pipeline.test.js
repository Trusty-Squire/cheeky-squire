const test = require("node:test");
const assert = require("node:assert");
const { run } = require("../src/pipeline.js");

// Correct values assume u21 subtracts 1 (n - 1).
// run(n) = (((n+3)*2 - 1)^2) + 10
test("pipeline computes the correct value", () => {
  assert.strictEqual(run(2), 91); // 5,10,9,81,91
  assert.strictEqual(run(0), 35); // 3,6,5,25,35
  assert.strictEqual(run(5), 235); // 8,16,15,225,235
});
