const test = require("node:test");
const assert = require("node:assert");
const { run } = require("../src/greet.js");

test("default greeting", () => {
  assert.strictEqual(run(["--name", "Ada"]), "Hello, Ada!");
  assert.strictEqual(run([]), "Hello, world!");
});
