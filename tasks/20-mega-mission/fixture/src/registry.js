// Handler registry — UNIMPLEMENTED (built by the `registry-core` node).
//
// Convention (the long-horizon contract):
//   register(h) MUST throw unless h.type matches /^[a-z]+(-[a-z]+)*$/
//     (kebab-case) AND typeof h.handle === 'function'.
//   all() returns the array of registered handlers, in registration order.
//
// The stub throws so an empty/forgotten implementation cannot pass.
function register(_h) {
  throw new Error("not implemented: registry.register");
}
function all() {
  throw new Error("not implemented: registry.all");
}
module.exports = { register, all };
