// Verify an encoded ledger string. To be implemented by the `verify` node.
// verify(encoded) splits on "|", recomputes (id + amountCents) % 97 padded to
// two chars, and returns true iff the trailing checksum matches.
module.exports = {};
