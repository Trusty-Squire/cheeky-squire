// Event store — UNIMPLEMENTED (built by the `store` node).
//
// A Store exposes add(event) and all(); all() returns the added events in
// insertion order. Export Store (class or factory). The stub throws.
class Store {
  add(_event) {
    throw new Error("not implemented: Store.add");
  }
  all() {
    throw new Error("not implemented: Store.all");
  }
}
module.exports = { Store };
