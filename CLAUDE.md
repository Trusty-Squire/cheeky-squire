# CLAUDE.md — Cheeky Squire v0.1

## What this is
A verification harness that lets cheap LLMs complete long
multi-step coding tasks reliably. v0.1 is an EXPERIMENT.
The deliverable is the benchmark table from
scripts/experiment.ts. SPEC.md is the design authority;
where SPEC.md and improvisation conflict, SPEC.md wins.
Where SPEC.md is silent, decide, record in ASSUMPTIONS.md,
proceed.

## Success contract — ALL must hold before declaring done
1. `pnpm test` — vitest, zero failures
2. `pnpm typecheck` — `tsc --noEmit`, zero errors
3. `pnpm lint` — eslint, zero errors
4. `node dist/cli.js run examples/demo.yaml --mock`
   — completes a 3-node mission end-to-end via MockEngine,
   exercising pack → run → reconcile → gate → checkpoint
   for real (real git ops in a temp dir), exit 0
4b. `node dist/cli.js run examples/demo.yaml --mock --harness off`
   — ablation (raw, goal-only): one attempt then scores every
   node's done_check, exit 0
5. `pnpm experiment --dry-run` — validates all 20 task
   fixtures + missions AND resolves the three-chain schema
   (cheap-raw, cheap, knight-only), prints the result table
   schema, exit 0
6. Zero network calls in tests. `OPENROUTER_API_KEY` must not
   be required for gates 1–5.

## Architecture invariants (do not violate)
- ALL model calls behind `LlmClient`; MockLlm in tests.
- ALL agent execution behind `Engine` (src/engine/types.ts);
  harness code never imports pi-mono directly.
- Gates are shell commands judged by exit code. No prose
  evaluation anywhere in this codebase.
- Node pass = git commit. Node fail = git reset to last green
  checkpoint BEFORE the next attempt.
- Blast radius is enforced BEFORE write/edit execution,
  in the harness, not trusted to the engine or the model.
- A node's context = system prompt + brief + packed files.
  Never mission history. Never another node's transcript.
- Budget meters are hard stops, checked after every LLM call.

## Phase 0 obligation (pi-mono)
Before implementing src/engine/pi.ts: install and READ the
pi-mono packages (github.com/badlogic/pi-mono — verify the
actual org/repo and package names via npm; do not guess).
Write ENGINE_NOTES.md per SPEC §6.2. If embedding with tool
interception is not feasible, record evidence and implement
BuiltinEngine per SPEC §6.3 instead. Timebox: one focused
pass. Decide, record, proceed. Do not stall.

## Scope fence (building any of this is drift — stop)
- No TUI, no colors beyond plain status lines, no spinners
- No `squire watch`, no init wizard, no persona features
- No Goose, no ACP, no MCP
- No model ranking, probes, bandit routing, or voting
- No real-API integration tests; the human runs the real
  experiment

## Behavior policy
- Never ask the human questions. Record assumptions in
  ASSUMPTIONS.md and proceed.
- Retry ladder per error: fix directly → re-read the
  surrounding module → re-read SPEC.md → after 3 failed
  attempts on the SAME error, stop and surface with the
  full error and what was tried.
- Conventional commits, one per module/milestone.
  Suggested order: schema → trace → gates → checkpoint →
  context → reconcile → budget → escalate → engine(mock) →
  runner → cli → demo → engine(pi or builtin) → derive →
  fixtures → experiment.
- Update STATE.md after each commit: done / in-progress /
  blocked / next.
- Tests accompany each module in the same commit, not at
  the end.

## Code standards
- tsconfig strict; no `any` except at validated boundaries
  (zod.parse the outside world, then types flow)
- zod schemas are the single source of truth for all file
  formats (mission.yaml, chains.yaml, engine scripts, trace)
- execa for all shell; never string-concatenate commands
- Errors: throw typed errors with context; the CLI catches
  at the top, prints one clear line + trace path, exits 1
