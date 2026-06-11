const test = require("node:test");
const assert = require("node:assert");
const { dedupe } = require("../src/dedupe.js");

test("dedupe removes duplicates preserving first-occurrence order", () => {
  assert.deepStrictEqual(dedupe([1, 2, 2, 3, 1]), [1, 2, 3]);
  assert.deepStrictEqual(dedupe(["a", "a", "b"]), ["a", "b"]);
  assert.deepStrictEqual(dedupe([]), []);
});
