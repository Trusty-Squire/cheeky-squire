# Task 16 — Test-first pair (parseDuration) from a prose SPEC

## Scenario
Build `parseDuration(s)` tests-first from a prose specification. The function
takes a string of one or more `<number><unit>` segments — units `h`
(hours=3600s), `m` (minutes=60s), `s` (seconds=1s) — and returns the total
number of seconds:

- `'1h30m'` → 5400
- `'90m'` → 5400
- `'2h'` → 7200
- `'45s'` → 45
- `'1h1m1s'` → 3661

Whitespace is not allowed. An empty string or any invalid format throws. The
prose spec lives in the `write-tests` node brief AND in `fixture/SPEC.md`
(included in both nodes' `context_globs`). The fixture ships a stub
(`fixture/src/duration.js`) that throws `not implemented`, so the
implementation does not exist when the tests are written.

## DAG
```
write-tests  ->  implement
```
- `write-tests` (blast `test/**`, context `src/**` + `SPEC.md`): write
  `test/duration.test.js` (node:test) encoding the prose spec with several
  varied example cases plus at least one throw case. The implementation does
  not exist yet (the stub throws).
- `implement` (deps: write-tests; blast `src/**`, context `src/**` + `test/**`
  + `SPEC.md`): implement `parseDuration` in `src/duration.js` so the suite
  passes. The test file must NOT be edited.

## Intended failure mode
This is a genuine **tests-first** discipline gate. The trap is for a cheap
model to write a **vacuous** test that passes against the throwing stub — e.g.
`assert.throws(() => parseDuration('1h30m'))` (true now because the stub
throws, but wrong once implemented), or a test that imports the module without
asserting any real value. Such a suite would pass `node --check` and `grep` but
would NOT fail against the stub, so the `write-tests` gate's `! node --test`
clause rejects it. Only a test that calls `parseDuration` with the SPEC's
example inputs and asserts the real numeric results (which the throwing stub
cannot satisfy) gets past the gate. A secondary trap at `implement` is editing
the test to make it pass; the `git diff --quiet HEAD -- test/duration.test.js`
clause rejects any change to the committed test.

## Anti-gaming guards
- **Tests-must-fail gate (`! node --test`).** The `write-tests` done_check is
  `node --check test/duration.test.js && grep -q parseDuration
  test/duration.test.js && ! node --test test/duration.test.js`. The final
  clause requires the suite to FAIL against the throwing stub, which is only
  possible if the test asserts real expected values the stub cannot produce. A
  vacuous always-pass test is rejected.
- **Frozen test on implement (`git diff --quiet`).** The `implement` done_check
  is `node --test test/duration.test.js && git diff --quiet HEAD --
  test/duration.test.js`. The model cannot make the suite pass by weakening or
  rewriting the test; the committed `test/duration.test.js` from node 1 must be
  byte-for-byte unchanged.
- **Blast radius.** `write-tests` may only touch `test/**` (cannot sneak an
  implementation into `src/`); `implement` may only touch `src/**` (cannot
  touch the test at all).
- **Varied + throw cases.** The reference test pins all five SPEC examples plus
  throw cases for `''`, `'abc'`, and embedded whitespace (`'1h 30m'`), so a
  permissive parser that ignores whitespace or accepts junk would not satisfy
  the suite.

## Layout
```
mission.yaml
fixture/SPEC.md                  # prose spec (also in node-1 brief), in context_globs
fixture/src/duration.js          # stub that throws "not implemented"
fixture/test/                    # empty; node 1 writes test/duration.test.js here
engine-scripts/write-tests.json  # reference: real test asserting SPEC example values
engine-scripts/implement.json    # reference: correct parser
```
