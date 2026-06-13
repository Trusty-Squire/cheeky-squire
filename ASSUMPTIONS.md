# ASSUMPTIONS.md

Decisions made where SPEC.md is silent. SPEC.md wins on conflict.

## Engine / pi-mono
- A1. The maintained pi packages are `@earendil-works/pi-ai` and
  `@earendil-works/pi-agent-core` (the `@mariozechner/*` ones are
  deprecated). We depend on the `@earendil-works` scope. Evidence in
  ENGINE_NOTES.md.
- A2. PiEngine is implemented (Phase 0 decision = feasible). BuiltinEngine
  is NOT built (SPEC §6.3 is a contingency that did not trigger).
- A3. Blast-radius enforcement and all real tool execution live in one
  harness `ToolExecutor`, shared by MockEngine and PiEngine. PiEngine
  also wires pi's `beforeToolCall` block hook so denial happens before
  execution and the run continues with an injected error result.

## Transport / cost
- A4. LLM transport for both the engine and the planner goes through
  OpenRouter via pi-ai's `openai-completions` API (`baseUrl`
  `https://openrouter.ai/api/v1`, key from `OPENROUTER_API_KEY`). Our
  own `LlmClient`/`Engine` interfaces sit above it (SPEC §2, §7).
- A5. Cost in USD is computed by the harness from `chains.yaml` prices
  (per-million in/out), NOT from pi's reported `cost`, because SPEC
  mandates prices be user-maintained config. Cache tokens are billed at
  the input price (v0.1 simplification; pricing table has no cache rate).
- A6. Token estimation for context-pack truncation uses a chars/4
  heuristic (no tokenizer dependency; deterministic, offline). Recorded
  in trace as an estimate.

## Schema / files
- A7. `mission.yaml` and `chains.yaml` are YAML, parsed then
  zod-validated. Engine scripts (MockEngine) and the trace are JSON/JSONL.
- A8. Node ids are unique within a mission; `deps` form a DAG (cycles
  rejected at validation). Execution order is a deterministic topological
  sort (stable by declaration order).
- A9. `workdir` in mission.yaml is resolved relative to the mission file's
  directory. `context_globs`/`blast_radius` are relative to `workdir`.
- A10. A node with no `deps` is a root. Multiple roots allowed. The
  mission completes when all nodes are COMMITTED; it halts on the first
  node that exhausts the ladder (SPEC §5 state machine).

## Git / checkpoint
- A11. The harness operates on a real git repo at `workdir`. The first
  checkpoint ("last green") is the repo HEAD at mission start; each node
  pass commits `node(<id>): pass`. Reset is `git reset --hard <last-green>`
  followed by `git clean -fd` to drop untracked files from a failed
  attempt.
- A12. `setup-fixtures.ts` writes fixture files but does NOT git-init them;
  the experiment harness copies a fixture to a temp dir and runs
  `git init && git add -A && git commit` there (SPEC §12), keeping the
  source tree clean and tests hermetic.

## Reconcile / gates
- A13. Reconcile "writes appear in git diff": every write/edit the engine
  executed must touch a path that shows in `git status --porcelain`
  (staged or unstaged). A write whose content equals existing content
  (no-op) is allowed and not flagged.
- A14. Confabulation detection: if the engine's final message matches a
  test/lint/build claim regex AND no bash tool call running a
  test/lint/build-like command (or the exact done_check) exists in the
  attempt trace, set `confabulation_flag`. It is counted, never fails the
  node (the gate decides) — SPEC §5.5.
- A15. Gate timeout is 5 minutes (SPEC §5.6); stdout/stderr tails capped
  at 4KB each.

## Derive
- A16. `squire derive` uses the chain's `knight` model via `LlmClient`.
  Repo survey = `git ls-files` + README/package.json/Cargo.toml contents
  + detected check commands. Schema-validate; one retry with errors
  appended; second failure exits 1. `{"error": "..."}` from the model
  exits 1 with that message. `--yes` skips the proceed prompt.

## Benchmark fixtures
- A18. Fixture gates use Node's built-in test runner (`node --test`) and
  `node -e`/`node --check`, NOT vitest. This keeps every fixture dependency-free
  and hermetic: the experiment copies a fixture into a temp dir and runs it with
  no `npm install` and no network. SPEC §11 says "real vitest suites"; node:test
  is an equivalent objective gate that satisfies the no-network/no-install
  constraint. Fixtures are committed CommonJS `.js` files.
- A19. Ungameable gates: nodes that must not touch their own checks have the
  test file OUTSIDE their blast_radius, plus a `git diff --quiet HEAD -- <test>`
  guard as defense-in-depth (and `node --check`/`grep` guards for test-writing
  nodes). Verified: a cheating agent that rewrites a test is blast-denied and the
  node still fails (test/experiment/experiment.test.ts).
- A20. The experiment supports `--mock` (MockEngine + per-node engine-scripts in
  each task's engine-scripts/) for offline, network-free self-verification of the
  whole benchmark. The real measurement (`pnpm experiment` with a real chain) is
  run by the human with OPENROUTER_API_KEY (SPEC §12). `--dry-run` validates all
  fixtures+missions and prints the table schema (gate 5).

## Anti-gaming (v0.1.1)
- A21. Three reusable gate primitives keep done_checks ungameable:
  (1) behavior gates assert ≥2 varied input/output pairs so a constant or
  small-branch hardcode fails; (2) tests-first nodes require the suite to FAIL
  against the stub (`! node --test …`) so a vacuous test can't let a later node
  ship a stub; (3) write-test-after-impl nodes use `fixture/checks/mutation-guard.sh`
  — the new test must pass against the real module and FAIL against a planted
  mutant in `fixture/checks/<mod>.mutant.js`. Mutants and the guard live in
  `checks/` (outside every blast_radius) so no node can tamper with them.
- A22. experiment.ts archives each run's trace to
  `results/<runId>/<task>-<chain>.jsonl` before the temp workdir is reaped
  (results/ is gitignored; archiving is the audit trail).

## v0.2 build decisions
- A23. Raw-mode (harness off) scoring treats human gates as not-passed with a
  note: unattended scoring cannot adjudicate. Judge gates score soft.
- A24. `ser do` quick mode defaults to an OPEN blast radius ("**") — single
  supervised goal with the user present; tighten with --radius. Gate is
  inferred mechanically from repo check commands; no detectable gate = refusal
  (never an ungated node).
- A25. `ser fix` repro gates demand an assertion-failure signature
  (AssertionError|expected|FAIL) and reject ENOENT — the dogfood
  poisoned-fixture lesson applied to bug repros.
- A26. Spec drift flags are proposer-marked only in v0.2; a mechanical
  NLI-style thesis-contradiction check is v0.3.
- A27. v0.2's working definition of a "verified" ledger claim is
  adversarial-survival: it survived the feasibility-arithmetic and prior-art
  refutation lenses, with the lens trail recorded as evidence. No live web
  retrieval ships in v0.2 core; lenses run on model knowledge + arithmetic
  (sufficient for the poker class; insufficient for fast-moving facts — known
  limitation).

- A28. The unified interface (`ser talk`) routes through the EXISTING
  delta-mapper call — one new `action` field (check|verify|derive|run|status),
  not a second router model. The mapper may only REQUEST a command; the
  harness executes it mechanically and prints its own report (gate verdicts,
  costs, commits) — the model never performs work and never reports results.
  `run` re-derives when the spec is newer than the compiled mission (mtime)
  and requires one y/N spend confirmation; unconfirmed or non-TTY = cancelled.
  The mission compiles to `<name>.mission.yaml` next to the spec. Dogfood
  origin: "build it, report when done" — the sentence should work, mechanically.

## CLI
- A29. The API key lives in ONE place: `~/.config/castellan/.env`
  (override via $CASTELLAN_HOME or $XDG_CONFIG_HOME). `ser login` writes it
  there (mode 600), preferring a key already in the environment so a scattered
  project `.env.local` can be consolidated in one command. Env loading reads a
  FIXED set — `<cwd>/.env.local`, `<cwd>/.env`, then the global file — and
  NEVER walks up the directory tree (the old walk-up made the effective key
  depend on cwd and on stray ancestor `.env` files; that footgun is gone). The
  real process environment always wins over every file.
- A17. Commands: `run <mission> [--mock] [--chain <name>]`,
  `derive "<goal>" [--yes] [--chain <name>]`, `trace <file>`,
  `experiment` (delegated to scripts/experiment.ts via pnpm). Top-level
  catch prints one line + trace path, exits 1.
