// Plugin registry — UNIMPLEMENTED.
//
// Convention (the whole task hangs on this):
//   register(h) MUST throw unless h.name is kebab-case
//     (/^[a-z]+(-[a-z]+)*$/) AND typeof h.handle === 'function'.
//   all() returns the array of registered handlers, in registration order.
//
// Implement these per the mission's registry-core node. The stub throws so an
// empty/forgotten implementation cannot pass.
function register(_h) {
  throw new Error("not implemented");
}
function all() {
  throw new Error("not implemented");
}
module.exports = { register, all };
