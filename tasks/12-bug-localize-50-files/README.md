# Task 12 — Bug localization across 5 files inside a ~50-file fixture

## Scenario
`fixture/src/util/` contains 50 modules `u00.js` … `u49.js`. **45 are inert
decoys** (`module.exports = (n) => n;`). **Five form an active pipeline**, each
applying one arithmetic step:

| module | intended step |
|--------|---------------|
| `u07`  | `n + 3`       |
| `u13`  | `n * 2`       |
| `u21`  | `n - 1`  ← **shipped BROKEN as `n + 1`** |
| `u34`  | `n * n`       |
| `u42`  | `n + 10`      |

`src/pipeline.js` exports `run(n) = u42(u34(u21(u13(u07(n)))))`, i.e.
`(((n+3)*2 - 1)^2) + 10`. `test/pipeline.test.js` asserts the CORRECT values
(`run(2)===91`, `run(0)===35`, `run(5)===235`). With the planted bug (`u21 = n+1`)
the pipeline test FAILS — the task is real in the baseline fixture.

## DAG (2 nodes)
```
fix-bug ──▶ regression
```
- **fix-bug** — localize and fix the single defective stage so the pipeline test
  passes. `context_globs: ["src/**","test/**"]` (the model must read across the
  pipeline files to find which of the 5 stages is wrong). `blast_radius:
  ["src/**"]`. `done_check: node --test test/pipeline.test.js && git diff
  --quiet HEAD -- test/pipeline.test.js`. Reference fix edits ONLY
  `src/util/u21.js` from `n + 1` to `n - 1`.
- **regression** — `deps:[fix-bug]`. Write `test/regression.test.js` importing
  `u21` directly and pinning `u21(5)===4`, `u21(1)===0`, `u21(-3)===-4`.
  `blast_radius:["test/**"]`.

## Intended failure mode
**Context overload across ~50 files.** A cheap model dumped 50 near-identical
modules struggles to localize the single wrong stage. Likely failure paths:
- It can't identify which 5 of 50 modules are even active and burns budget /
  gives up.
- It patches the symptom in the wrong place — e.g. tweaks `pipeline.js`, a decoy,
  or another stage (`u34`/`u42`) to make some numbers line up, which breaks the
  varied `run(0)`/`run(5)` cases and fails the multi-input gate.
- It edits the test to match the buggy output — blocked by
  `git diff --quiet HEAD -- test/pipeline.test.js`.

## Anti-gaming guards
- **Varied input/output pairs:** `pipeline.test.js` asserts three distinct
  inputs (2, 0, 5); `regression.test.js` pins three distinct `u21` cases
  (positive, one-to-zero, negative). A symptom patch that fixes one case fails
  the others.
- **No test editing:** `git diff --quiet HEAD -- test/pipeline.test.js` forces
  the fix into source, not the assertions.
- **Mutation guard** on the regression node: the regression test must PASS
  against the real `u21` AND FAIL against the planted mutant
  `checks/u21.mutant.js` (`(n) => n + 1`, the original bug), so a vacuous test
  can't satisfy the gate. The mutant and `checks/` live OUTSIDE every node's
  `blast_radius`.
- **Tests outside impl blast_radius:** `fix-bug` can only touch `src/**`, so it
  cannot weaken `test/**` to pass.

## Dependency-free
Fixtures are CommonJS Node with zero deps. Gates use only `node --test`,
`grep`, `git`, and `bash`. The experiment copies `fixture/` into a temp git repo
with no install. `engine-scripts/<nodeId>.json` hold the reference solution so
`pnpm experiment --tasks 12 --mock` completes 2/2.
