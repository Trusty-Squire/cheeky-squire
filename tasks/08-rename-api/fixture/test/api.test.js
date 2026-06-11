const test = require("node:test");
const assert = require("node:assert");
const { evaluate, runAll } = require("../src/index.js");

test("public API uses evaluate", () => {
  assert.strictEqual(typeof evaluate, "function");
  assert.strictEqual(evaluate(2, 3), 5);
  assert.deepStrictEqual(runAll([[1, 1], [2, 2]]), [2, 4]);
});
