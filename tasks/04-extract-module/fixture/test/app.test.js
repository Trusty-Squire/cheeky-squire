const test = require("node:test");
const assert = require("node:assert");
const { greet, farewell } = require("../src/app.js");

test("greet and farewell", () => {
  assert.strictEqual(greet("Ada"), "Hello, Ada!");
  assert.strictEqual(farewell("Ada"), "Bye, Ada!");
});
