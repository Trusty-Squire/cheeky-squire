const test = require("node:test");
const assert = require("node:assert");
const { createUser } = require("../src/service.js");

test("createUser renders name and email", () => {
  assert.strictEqual(createUser({ name: "Ada", email: "ada@x.dev" }), "Ada <ada@x.dev>");
  assert.strictEqual(createUser({ name: "Bo" }), "Bo <>");
});
