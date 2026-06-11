// Wire module C — UNIMPLEMENTED (built by the `wire-c` node).
//
// Exports a(x) and b(x). Each calls emit(...) (from ../emit.js) at ONE site,
// dispatching a 'ping' event whose payload.n derives from x. The two exported
// functions are two distinct call sites. The stub throws.
module.exports = {};
