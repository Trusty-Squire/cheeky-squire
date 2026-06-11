// Emit API — UNIMPLEMENTED (built by the `emit-v1` node, migrated by
// `emit-migrate`).
//
// v1:  emit(type, payload)  — makes an event, stores it, dispatches to the
//      handler whose type matches, and returns the handle result.
// v2 (after migration): emit(event) — takes a single { type, payload } object.
//
// The stub throws.
module.exports = {};
