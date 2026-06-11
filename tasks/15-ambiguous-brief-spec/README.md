# Task 15 — Ambiguous brief, disambiguated by SPEC.md

## Scenario
Implement `roundHalfEven(x)`, which rounds a number to the nearest integer.
The brief is deliberately ambiguous between two plausible readings of how to
handle an exact half (a fractional part of exactly `0.5`):

- **Common/naive reading:** round half *up* — i.e. just `Math.round(x)`.
- **Intended reading:** round half *to even* (banker's rounding) — a half goes
  to the nearest EVEN integer.

The two readings agree on every non-half value and DIFFER only on exact halves
(`0.5`, `1.5`, `2.5`, ...). The fixture ships `fixture/SPEC.md`, which fixes the
intended reading. Both nodes' `context_globs` include `SPEC.md`, and the gates
accept ONLY the SPEC-consistent (round-half-to-even) reading.

## DAG
```
implement  ->  lock-tests
```
- `implement` (blast `src/**`): read SPEC.md, implement `roundHalfEven` in
  `src/round.js` per round-half-to-even.
- `lock-tests` (deps: implement, blast `test/**`): write `test/round.test.js`
  pinning the half-to-even behavior, then mutation-guard it against a half-up
  mutant.

## Intended failure mode
A cheap model that does NOT consult `SPEC.md` defaults to the common reading and
implements `Math.round` (round-half-up). That implementation FAILS the
`implement` gate on the distinguishing half cases:
`Math.round(0.5) === 1 !== 0` and `Math.round(2.5) === 3 !== 2`. Only an
implementation that actually reads the SPEC and applies banker's rounding
passes.

## Anti-gaming guards
- **Distinguishing inputs in the behavior gate.** The `implement` done_check
  asserts `≥2` varied inputs INCLUDING the half cases (`0.5->0`, `1.5->2`,
  `2.5->2`, `3.5->4`, `-0.5->0`) that a half-up impl gets wrong, plus non-half
  cases (`2.4->2`, `2.6->3`). A `Math.round` solution cannot pass.
- **Mutation guard on the "write-test after impl" node.** `lock-tests` runs
  `checks/mutation-guard.sh` with a planted half-up mutant
  (`checks/round.halfup.mutant.js` = `return Math.round(x)`). The guard passes
  only if `test/round.test.js` PASSES against the real module AND FAILS against
  the half-up mutant — proving the test genuinely distinguishes the two readings
  rather than asserting something vacuous both readings satisfy.

## Layout
```
mission.yaml
fixture/SPEC.md                         # fixes the intended reading
fixture/src/round.js                    # stub that throws
fixture/checks/mutation-guard.sh        # copied verbatim from task 03
fixture/checks/round.halfup.mutant.js   # planted half-up mutant
engine-scripts/implement.json           # reference solution (banker's rounding)
engine-scripts/lock-tests.json          # reference test suite
```
