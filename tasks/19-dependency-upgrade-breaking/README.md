# Task 19 — dependency upgrade with BREAKING changes

## Scenario
A dependency-free CommonJS fixture vendors a tiny dependency `jsonfmt` under
`fixture/vendor/`. Two copies ship:

- `vendor/jsonfmt/index.js` — **v1 (currently installed)**:
  ```js
  module.exports = { version: '1.0.0', format: (obj) => JSON.stringify(obj) };
  ```
- `vendor/jsonfmt-v2/index.js` — **v2 (upgrade target, BREAKING)**: `format`
  now takes a second `opts` argument and **throws** unless `opts.pretty` is a
  boolean:
  ```js
  format: (obj, opts) => {
    if (!opts || typeof opts.pretty !== 'boolean') throw new Error('opts.pretty required');
    return JSON.stringify(obj, null, opts.pretty ? 2 : 0);
  }
  ```

`fixture/deps.lock.json` pins `{ "jsonfmt": "1.0.0" }`. `src/report.js` and
`src/summary.js` each `require('../vendor/jsonfmt')` and call `format(obj)`
v1-style (no opts) at **two** sites apiece; `src/index.js` re-exports all four
functions.

`fixture/test/report.test.js` asserts the **post-upgrade** behavior:
`report(...)` must render **pretty** (2-space) JSON and `summary(...)` must
render **compact** JSON. That only holds once jsonfmt is v2 **and** report
callers pass `{ pretty: true }` while summary callers pass `{ pretty: false }`.
So the **baseline fixture FAILS the suite** (verified: `node --test` exits 1),
and on the baseline v2 isn't even installed — the goal is to upgrade and
migrate the call sites so the suite goes green.

The experiment copies `fixture/` into a fresh temp git repo with **no install**
and runs every gate with `node` / `node --test` / `node --check` / `grep` /
`git` only. No npm, no network.

## DAG (3 nodes, chain: cheap, budget $1.80)

```
upgrade-dep ──── $0.60   copy vendor/jsonfmt-v2 over vendor/jsonfmt, bump deps.lock.json to 2.0.0
      │                  blast: ["vendor/jsonfmt/**","deps.lock.json"]
      ▼
fix-callers ──── $0.70   report -> {pretty:true}, summary -> {pretty:false}; COMPILE + COMPLETENESS gate
      │                  blast: ["src/**"]
      ▼
verify ───────── $0.50   run suite + diff-guard test + re-assert lockfile
                         blast: ["src/**"]
```

## Intended failure mode (why this is hard for a cheap model)
The upgrade is a **breaking** one spread across two concerns. A cheap model
typically:
- bumps the lockfile or swaps the vendor file but **forgets the other half**
  (lockfile says 2.0.0 while `vendor/jsonfmt` is still v1, or vice-versa); or
- swaps in v2 but leaves the callers single-arg — every `format(obj)` then
  **throws `opts.pretty required`** at require/exercise time; or
- migrates the *obvious* `report`/`summary` entry sites but misses the second
  call site in each file (`reportWrapped` / `summaryWrapped`); or
- passes the **wrong** `pretty` flag, making report compact or summary pretty,
  which the diff-guarded test catches.

Any of these leaves the suite red, a leftover single-arg call, or a stale
lockfile — all of which a gate detects.

## Anti-gaming guards
- **Node `upgrade-dep` (content proof + breaking-behavior assert):** because
  per-node commits make `git diff HEAD` unreliable, the lockfile change is
  proven by **content**: `grep -q '"jsonfmt": "2.0.0"'` **and**
  `! grep -q '1.0.0'`. It then loads the vendored module and asserts
  `version==='2.0.0'` and that v2 actually runs (`format({x:1},{pretty:false})
  === '{"x":1}'`), **and** asserts the breaking semantics — single-arg
  `format({x:1})` must **throw**. A model can't satisfy this by editing only
  the lockfile or only the vendor file.
- **Node `fix-callers` (compile + varied behavior + completeness):**
  1. `for f in $(find src -name '*.js'); do node --check "$f" || exit 1; done`
     — every src file must parse (compile gate).
  2. `node -e` exercises `report`/`summary` through the real `index.js` on
     **two varied objects each** (`{a:1}`/`{k:9}` pretty, `{b:2}`/`{m:7}`
     compact) — can't be hardcoded for one input, and asserts the
     pretty/compact split.
  3. `! grep -rEn 'format\([^,)]*\)' src` — asserts **zero** single-argument
     `format(...)` calls remain anywhere under `src`. It MATCHES (4 hits) on
     the unmigrated tree and finds NOTHING once every call site passes
     `{ pretty: ... }`. A leftover single-arg call both trips this grep and
     **throws** at runtime under v2.
- **Node `verify` (diff-guard + lockfile re-assert):**
  `git diff --quiet HEAD -- test/report.test.js` — the test must be
  byte-identical to HEAD (it lives in `test/**`, outside every blast radius, so
  it can't be edited), so a model cannot "pass" by weakening the test. Re-runs
  the suite and re-asserts the lockfile is at 2.0.0.

## Reference solution
`engine-scripts/{upgrade-dep,fix-callers,verify}.json` are correct reference
replays whose writes stay inside each node's blast radius, so
`pnpm experiment --tasks 19 --chains cheap --mock` completes **3/3** with
0 blastDenied.
