// MUTANT of packages/core/src/numbers.js: clamp ignores the upper bound.
// A real test that checks the above-hi case must catch this.
function clamp(n, lo, _hi) {
  return n < lo ? lo : n; // MUTANT: never clamps to hi
}
module.exports = { clamp };
