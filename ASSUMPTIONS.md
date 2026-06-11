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

## CLI
- A17. Commands: `run <mission> [--mock] [--chain <name>]`,
  `derive "<goal>" [--yes] [--chain <name>]`, `trace <file>`,
  `experiment` (delegated to scripts/experiment.ts via pnpm). Top-level
  catch prints one line + trace path, exits 1.
