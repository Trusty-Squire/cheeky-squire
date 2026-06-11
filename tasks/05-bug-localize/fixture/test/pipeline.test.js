const test = require("node:test");
const assert = require("node:assert");
const { run } = require("../src/pipeline.js");

test("pipeline doubles each number", () => {
  assert.strictEqual(run("1,2,3"), "2-4-6");
  assert.strictEqual(run("10,20"), "20-40");
  assert.strictEqual(run("5"), "10");
  assert.strictEqual(run("0,7,3"), "0-14-6");
});
