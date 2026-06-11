// Canonical ledger encoder. To be implemented by the `encoder` node.
//
// encode(record) returns the string `${id}|${amountCents}|${cc}` where the
// 2-char checksum cc is:
//
//     String((id + amountCents) % 97).padStart(2, "0")
//
// Note carefully: the modulus is 97 (NOT 100), and cc is always zero-padded
// to exactly two characters. These two details are the contract the rest of
// the pipeline (encodeAll, buildIndex, verify) depends on.
module.exports = {};
