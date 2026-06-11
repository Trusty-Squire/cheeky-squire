# Task 17 — workspace-two-packages

## Scenario
A dependency-free CommonJS "workspace" with two packages under
`fixture/packages/`:

- `core/` — leaf utilities: `slugify`, `titleCase` (strings.js), `clamp`
  (numbers.js).
- `app/` — consumes `core` through **relative requires**
  (`require("../../core/src/strings.js")`, `require("../../core/src/numbers.js")`)
  and builds a small CLI on top: `greet`, `bound`, `run`.

There are no npm workspaces, no symlinks, no `package.json` linkage — the
cross-package edge is a literal relative path that must resolve from the
workdir root when gates run (`node --test packages/<pkg>/test/<x>.test.js`,
`node -e "require('./packages/...')"`).

Baseline `src/*.js` files are shipped as throwing stubs so every impl node has
real work; the `test/` directories ship empty (test nodes create the suites).

## DAG (10 nodes)

```
core-slugify ──┬── core-titlecase ── core-strings-test ── app-greeting ──┐
               │                                                          ├── app-cli ── app-test ── integration
               └── core-clamp ────── core-numbers-test ── app-bound ─────┘
```

- `core-slugify` (blast: core src) — kebab-case slugify, varied gate.
- `core-titlecase` (deps: core-slugify; blast: core src) — titleCase, varied gate.
- `core-strings-test` (deps: core-titlecase; blast: core test) — strings suite + **mutation guard**.
- `core-clamp` (deps: core-slugify; blast: core src) — clamp, varied gate (below-lo / above-hi / in-range).
- `core-numbers-test` (deps: core-clamp; blast: core test) — numbers suite + **mutation guard**.
- `app-greeting` (deps: core-strings-test; blast: app src) — greet() over core strings, varied deep-equal gate.
- `app-bound` (deps: core-numbers-test; blast: app src) — bound()=clamp(n,0,100), varied gate.
- `app-cli` (deps: app-greeting, app-bound; blast: app src) — run(argv) parses `--name/--score`, varied gate (two argv).
- `app-test` (deps: app-cli; blast: app test) — app suite + **mutation guard**.
- `integration` (deps: app-test; blast: app test) — end-to-end cross-package run + **diff guard** on app.test.js.

The two core sub-chains (strings vs numbers) run in parallel and re-converge at
`app-cli`, so the DAG is a real diamond, not a straight line.

## INTENDED FAILURE MODE — cross-package consistency
The trap is the cross-package contract: a behavior fixed in `core` must be
honored verbatim by `app`, and the app gates assert the **composed** result, not
each half in isolation.

A cheap model typically loses this contract in one of these ways:

- Re-implements slugify/titleCase/clamp **inline inside `app`** instead of
  requiring `core`, so a later change in `core` is silently ignored — the app
  gates use the same inputs as the core gates (`ada lovelace`, `grace hopper`,
  scores 42/150/250) precisely so an app that drifts from core fails.
- Gets the **relative require path wrong** (`../core/...` vs `../../core/src/...`),
  which throws at require time and fails the gate from the workdir root.
- Honors only one side of the contract — e.g. `run()` returns the title but
  drops the bounded score, or clamps the low bound but not the high bound — which
  the varied gates and the `cli.mutant.js` guard catch.

The full chain only completes if `app` genuinely consumes `core` and threads the
exact `slugify → titleCase → clamp` behavior end-to-end.

## Anti-gaming guards
- **Varied inputs (≥2):** every behavior gate asserts at least two different
  inputs (e.g. `slugify('Hello World')` and `slugify('A_B c')`; two full argv
  runs for the CLI; below-lo / above-hi / in-range for clamp).
- **Mutation guards (write-test-after-impl nodes):** `core-strings-test`,
  `core-numbers-test`, and `app-test` run `checks/mutation-guard.sh`, which
  proves the suite passes against the real module **and fails** when a planted
  mutant is swapped in:
  - `checks/strings.mutant.js` — slugify drops spaces instead of emitting `-`.
  - `checks/numbers.mutant.js` — clamp ignores the upper bound.
  - `checks/cli.mutant.js` — run() omits the bounded score from its output.
  A vacuous/no-op test passes against the mutant and is rejected.
- **Diff guard:** `integration` asserts `git diff --quiet HEAD -- packages/app/test/app.test.js`,
  so the integration node cannot weaken or rewrite the previously-committed app
  suite to make its own gate pass.
- **Blast radius:** impl nodes are fenced to `packages/<pkg>/src/**`; test nodes
  to `packages/<pkg>/test/**`. Tests live outside the impl nodes' blast radius,
  so an impl node cannot edit a test to pass, and a test node cannot patch the
  implementation.

## Verify
```
pnpm experiment --tasks 17 --chains cheap --mock
# -> completed=true nodes=10/10
```
