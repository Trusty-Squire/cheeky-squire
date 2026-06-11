# AUDIT.md — adversarial gate audit (v0.1.1, Phase A)

Scope: locate experiment traces; adversarially audit tasks 08, 09, 10 (cheap
chain) per node for (a) claimed work present in the committed diff, (b) gate
not vacuously passable (construct a null solution), (c) confabulation flags;
then fix every gameable gate in tasks 01–10.

## Finding #0 (process) — traces were not archived

`experiment.ts` wrote each run's trace into the per-task temp workdir, which is
`rmSync`'d in `runTask`'s `finally`. **The completed live run's traces were
therefore unrecoverable.** Fixed first: `runTask` now archives the trace to
`results/<runId>/<task>-<chain>.jsonl` before cleanup (`runId`/`resultsDir`
threaded from `experiment.ts`). The (a)/(c) audit below was run on freshly
archived traces from a mock reference-solution run; (b) was tested directly
against the gates with constructed null solutions.

## (a) Work-in-diff and (c) confabulation — CLEAN

Across 08/09/10 cheap (archived reference-solution traces):
- every `reconcile` event: `violations: [], missingFromDiff: [], outOfRadius: []`
- checkpoints == passes per task (08: 3/3, 09: 3/3, 10: 5/5), `blast_denied: 0`
- `confabulation_flag` events: **0**

The reconcile pass (every executed write appears in the diff, nothing outside
blast radius) and the confabulation detector behaved correctly. No claimed work
was absent from the committed diff.

## (b) Vacuous-pass audit — MULTIPLE GAMEABLE GATES FOUND

Each null solution below was constructed and confirmed to pass the *original*
gate, then confirmed blocked after the fix.

### Class 1 — hardcodeable behavior gates (a constant defeats a single fixed input)

| task / node | null solution that passed | fix |
|---|---|---|
| 08 `rename-def` | `module.exports={evaluate:()=>{}}` (no-op stub) | gate now asserts `evaluate(2,3)===5 && evaluate(10,20)===30` |
| 08 `update-callers` | `runAll=()=>[2,5]` (ignores input) | second varied input `runAll([[10,20],[4,5]])===[30,9]` |
| 10 `op-add` | `add=()=>5` | `add(10,7)===17 && add(-4,1)===-3` added |
| 10 `op-subtract` | `subtract=()=>3` | `subtract(9,4)===5 && subtract(0,7)===-7` added |
| 10 `op-multiply` | `multiply=()=>12` | `multiply(6,7)===42 && multiply(-3,3)===-9` added |
| 10 `evaluate` | `(op)=>op==='+'?5:op==='-'?3:6` | varied operands per op (`evaluate('+',10,20)===30`, …) |
| 03 `impl-multiply` | 2-branch constant `(a,b)=>a===0\|\|b===0?0:12` | `multiply(6,7)===42 && multiply(-3,3)===-9` added |
| 06 `parse-flag` | `(a)=>({shout:a.length>0})` | added `parseArgs(['--name','x']).shout===false` and `['--name','x','--shout']` |
| 06 `apply-flag` | hardcode two fixed strings | added lowercase `bo`→`BO` case + `run([])` default |

### Class 2 — tests-first node let node 2 ship a stub (HIGH severity)

| task / node | exploit | fix |
|---|---|---|
| 09 `write-tests` → `implement` | node 1 writes `// discount` (passes `node --check` + `grep`); the vacuous "test" then passes against the unimplemented stub, so node 2 commits the throwing stub and the mission "completes" with no implementation | node 1 gate now requires the suite to **fail against the stub**: `node --check … && grep -q discount … && ! node --test test/cart.test.js`. A vacuous test passes against the stub → `! node --test` fails → node 1 rejected. |

### Class 3 — vacuous tests in write-test-after-impl nodes

A comment-only test file passes `node --test` (Node counts the file as one
passing test) and `grep`. Lower severity (the implementation was already gated
by a real behavior check in the prior node, so no broken code ships — only fake
coverage), but still gameable. Fixed with a reusable **mutation guard**
(`fixture/checks/mutation-guard.sh`): the new test must pass against the real
module AND **fail** when a planted mutant (`fixture/checks/<mod>.mutant.js`,
outside every blast radius) is swapped in.

| task / node | planted mutant | 
|---|---|
| 03 `test-multiply` | `multiply` returns `a+b` |
| 05 `regression-test` | `transform` adds 1 (the original bug) |
| 06 `test-flag` | `greet` ignores `--shout` |
| 09 `boundary` | discount threshold `>=100` (off-by-one; breaks only the exactly-100 case) |
| 10 `suite` | `evaluate` ignores the operator (always adds) |

Also strengthened task 05's `pipeline` test with two extra varied cases.

## Gates judged robust (no change)

01 (3 varied cases + diff-guard), 02 (4 varied cases + diff-guard),
04 (real suite + diff-guards on both the test and the extracted module),
07 (field-existence + real suite + diff-guard — the "null solution" *is* the
real solution), 08 `reexport-and-compile` (compile gate + real suite +
diff-guard).

## Verdict

11 gameable gates found across tasks 03, 05, 06, 08, 09, 10 (one HIGH severity:
the tests-first chain in 09). All fixed and re-verified: every constructed null
solution is now rejected, and all reference solutions still pass. Trace
archiving added so future audits have evidence. Reusable anti-gaming primitives
established for v0.1.1 tasks 11–20: varied-input behavior gates,
fail-against-stub for tests-first, and the mutation-guard for write-test nodes.
