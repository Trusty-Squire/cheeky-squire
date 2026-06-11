const test = require("node:test");
const assert = require("node:assert");
const { reverse } = require("../src/strings.js");

test("reverse reverses characters", () => {
  assert.strictEqual(reverse("abc"), "cba");
  assert.strictEqual(reverse(""), "");
  assert.strictEqual(reverse("a"), "a");
  assert.strictEqual(reverse("racecar"), "racecar");
});
