# Task 13 — API migration touching 12+ call sites + compile gate

## Scenario
A dependency-free CommonJS fixture exposes a logging API in
`fixture/src/logger.js`:

```js
function log(message) { return `[LOG] ${message}`; }
```

Six feature modules `fixture/src/feat/f1.js`..`f6.js` each call `log(...)`
at **two** sites (12 call sites total), and `fixture/src/index.js` requires
all six and re-exports them as `{ f1..f6 }`.

The mission migrates the API to a leveled signature:

```js
function log(level, message) { return `[${level.toUpperCase()}] ${message}`; }
```

Every call site must be updated to pass an explicit level. We use `'info'`
so the existing messages render as `[INFO] ...`.

`fixture/test/api.test.js` is written to expect the **migrated** `[INFO] ...`
outputs. Therefore the **baseline fixture FAILS the suite pre-migration**
(unmigrated single-arg calls produce `[LOG] ...`). The nodes migrate the tree
to make the suite pass. The experiment copies the fixture into a fresh temp
git repo with **no install** and runs gates with `node`/`grep`/`git` only.

## DAG (3 nodes, chain: cheap, budget $1.80)

```
change-signature ── $0.50   change src/logger.js to log(level, message)
        │
        ▼
migrate-callers ─── $0.80   update all 12 call sites in src/feat/*.js, COMPILE GATE
        │
        ▼
tests ───────────── $0.50   run full suite + lock test/api.test.js (diff-guard)
```

## Intended failure mode (why this is hard for a cheap model)
The migration is mechanical but **broad**: 12 call sites spread across six
files. A cheap model typically:
- changes the signature and a few obvious call sites, then declares done,
  leaving several `src/feat/*.js` files still calling `log('f4:'+x)` with a
  single argument; or
- updates `f1`/`f2` (the ones it "sees") but misses `f4`/`f5`/`f6`.

Any leftover single-arg call site produces `[LOG] ...` (because `level` becomes
the message and `message` is `undefined` → `[UNDEFINED]`/`[LOG]`-shaped wrong
output), so `test/api.test.js` fails AND the completeness grep finds a leftover.

## Anti-gaming guards
- **Node 1 (varied + negative):** asserts `log('info','hi')==='[INFO] hi'`
  AND `log('warn','yo')==='[WARN] yo'` (two varied inputs, two different
  levels) AND that the old shape is gone: `log('hi')!=='[LOG] hi'`. A model
  cannot hardcode one case.
- **Node 2 (compile + completeness gate):**
  1. `for f in $(find src -name '*.js'); do node --check "$f" || exit 1; done`
     — every src file must parse (compile gate).
  2. `node -e` checks three migrated outputs from **different** modules
     (`f1.a`, `f3.b`, `f6.a`) through the real `index.js` — can't be satisfied
     by editing one file.
  3. `! grep -rEn 'log\([^,]*\)' src/feat` — asserts **zero** single-argument
     `log(...)` calls remain anywhere under `src/feat`. This is the completeness
     check: it MATCHES (12 hits) on the unmigrated tree and finds NOTHING once
     every call site passes a level. Verified that a correctly migrated tree
     passes and any leftover single-arg call fails.
- **Node 3 (diff-guard):** `git diff --quiet HEAD -- test/api.test.js` — the
  test file must be byte-identical to HEAD, so a model cannot "pass" the suite
  by weakening the test. The test asserts seven outputs across six modules.

## Reference solution
`engine-scripts/{change-signature,migrate-callers,tests}.json` are correct
reference replays (writes confined to the `src/**` blast radius) that make
every gate pass, so `pnpm experiment --tasks 13 --mock` completes 3/3.
