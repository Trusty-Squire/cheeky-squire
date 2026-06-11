// Event factory — UNIMPLEMENTED (built by the `event-make` node).
//
// make(type, payload) returns { type, payload } but MUST validate:
//   - type is a non-empty string
//   - payload is a non-null object
// otherwise it throws. The stub throws so a forgotten implementation fails.
function make(_type, _payload) {
  throw new Error("not implemented: event.make");
}
module.exports = { make };
