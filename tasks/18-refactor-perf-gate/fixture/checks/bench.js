// Performance gate for dedupe. Builds a large array with many DISTINCT values
// (each appearing about twice), times dedupe, and asserts BOTH correctness of
// the result AND a wall-clock budget.
//
// Why this shape: the deduped output grows to N/2 distinct values, so an
// indexOf-based O(n^2) dedupe scans an ever-growing array — ~10^9 comparisons
// here, several seconds of work. An O(n) implementation (Set membership)
// finishes in ~15ms. The ~300x+ gap means the 1000ms threshold is robust to
// machine speed and noise: the slow version is never under it, the fast
// version is never near it.
const { dedupe } = require("../src/dedupe.js");

const N = 120000;
const M = N / 2; // number of distinct values; each value appears ~twice
const arr = [];
for (let i = 0; i < N; i++) arr.push(i % M);

const t0 = Date.now();
const out = dedupe(arr);
const elapsedMs = Date.now() - t0;

// Expected result: first occurrences are 0,1,...,M-1 in order.
let correct = out.length === M;
if (correct) {
  for (let i = 0; i < M; i++) {
    if (out[i] !== i) {
      correct = false;
      break;
    }
  }
}

const fast = elapsedMs < 1000;
process.stderr.write(`bench: N=${N} elapsedMs=${elapsedMs} correct=${correct} fast=${fast}\n`);
process.exit(correct && fast ? 0 : 1);
