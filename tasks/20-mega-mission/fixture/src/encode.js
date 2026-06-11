// Canonical event encoder — UNIMPLEMENTED (built by the `encode` node).
//
// encode(e) returns the string `${e.type}#${cc}` where the 2-char checksum cc
// is:
//
//     String([...e.type].reduce((a, c) => a + c.charCodeAt(0), 0) % 97)
//       .padStart(2, "0")
//
// Note carefully: the modulus is 97 (NOT 100), and cc is ALWAYS zero-padded to
// exactly two characters. These two details are the contract that the rest of
// the pipeline (encodeAll, verify) depends on. The stub throws.
module.exports = {};
