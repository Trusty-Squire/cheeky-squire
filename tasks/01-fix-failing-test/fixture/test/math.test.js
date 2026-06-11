const test = require("node:test");
const assert = require("node:assert");
const { add } = require("../src/math.js");

test("add sums two numbers", () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(-1, 1), 0);
  assert.strictEqual(add(0, 0), 0);
});
