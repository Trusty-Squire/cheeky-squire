# Task 18 — refactor under a performance gate

## Scenario
`src/dedupe.js` ships a `dedupe(arr)` that is **correct but slow**: it preserves
first-occurrence order, but scans the growing output array with `indexOf` for
every element, making it **O(n^2)**. The agent must refactor it to **O(n)**
(e.g. Set-based membership) without changing its observable behavior, then add a
property test that pins the contract down.

The twist is the **performance gate**: a bench script (`checks/bench.js`) runs
`dedupe` on a large array and fails unless the result is both correct AND under a
wall-clock budget. A passing correctness suite is not enough — the agent has to
actually improve the algorithmic complexity.

## DAG
```
optimize ──▶ property-test
```
- **optimize** (blast `src/**`): refactor `src/dedupe.js` to O(n), keeping
  identical behavior. `done_check`: correctness test passes, the test file is
  untouched (`git diff --quiet`), and `checks/bench.js` passes.
- **property-test** (blast `test/**`, deps `optimize`): add
  `test/property.test.js` asserting dedupe's properties on varied inputs.
  `done_check`: grep for `dedupe` in the new test + mutation guard.

## Intended failure mode
A cheap model is expected to keep the obvious `indexOf`-based O(n^2) approach
(or produce some other variant that still scans linearly per element). The
correctness test will pass — the slow code is *correct* — so the model thinks
it's done. But `checks/bench.js` times out against the 1000ms budget and the
`optimize` node fails its gate. Only a genuine O(n) refactor clears the gate.

## Why the perf gate is robust
The bench builds `N = 120000` elements drawn from `M = 60000` distinct values
(each value appears ~twice), so the deduped output grows to 60000 — meaning the
O(n^2) `indexOf` scan does on the order of 10^9 comparisons. Measured here:

| implementation | bench time | gate (`< 1000ms`) |
|---|---|---|
| shipped O(n^2) `indexOf` | ~5300 ms | **FAIL** |
| O(n) `Set` refactor | ~14 ms | **PASS** |

That's a ~300x+ gap, so the single 1000ms threshold is never close to either
side: the slow version is always far above it, the fast version always far
below it. The gate is insensitive to machine speed and noise. `bench.js` lives
in `checks/` (outside both nodes' blast radius), so the agent cannot weaken it.

## Anti-gaming guards
- **Correctness on ≥2 varied inputs.** `test/dedupe.test.js` checks
  `[1,2,2,3,1] → [1,2,3]`, `['a','a','b'] → ['a','b']`, and `[] → []` — numbers,
  strings, and empty — so a hard-coded or single-case "fix" can't pass.
- **Diff-guard on the correctness test.** The `optimize` done_check runs
  `git diff --quiet HEAD -- test/dedupe.test.js`, so the agent can't water down
  the correctness test to sneak a wrong implementation past the gate.
- **Performance gate outside blast radius.** `checks/bench.js` enforces the
  actual algorithmic improvement and cannot be edited (blast is `src/**`).
- **Mutation guard on the property test.** `checks/dedupe.mutant.js` implements
  `[...new Set(arr)].sort()` — fast and duplicate-free, but it **destroys
  first-occurrence order**. `checks/mutation-guard.sh` requires the new property
  test to PASS against the real module and FAIL against this mutant, so a weak
  test that only checks "no duplicates" (and ignores order) is rejected.
