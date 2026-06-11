// MUTANT: uses a Set (O(n), fast) but .sort() destroys first-occurrence
// order. It still removes duplicates, so a weak test that only checks
// "no duplicates" would PASS. The property test must assert order
// preservation to catch this.
function dedupe(arr) {
  return [...new Set(arr)].sort();
}
module.exports = { dedupe };
