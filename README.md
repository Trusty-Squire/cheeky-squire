# Cheeky Squire v0.1

**Thesis under test:** cheap models (Qwen / DeepSeek class) fail long, multi-step
coding tasks not because they can't write the code, but because of four
scaffold-fixable failure modes — context rot, silent failure, error compounding,
and format fragility. Cheeky Squire is a verification harness that gives each
task-node a *fresh minimal context*, verifies every node with an *objective gate*
(a shell command judged by exit code — never prose), *checkpoints* progress as git
commits, and *escalates* to a frontier model only after repeated failure. If the
thesis holds, a cheap verified chain reaches frontier-comparable completion at a
fraction of the cost.

v0.1 is an **experiment**, not a product. The deliverable is the benchmark table
from `pnpm experiment`: for each task × chain it reports completion, escalations
by rung, confabulation flags, retries, wall-clock, and dollars — cheap chain vs
frontier-only chain on the *same* tasks. The harness, not a planner, is what's
being measured, so the ten benchmark tasks ship as hand-written missions with
ungameable gates (test files sit outside each node's blast radius, with
`git diff` guards as backup, so a node can't pass by deleting its own test).

Every model call sits behind an `LlmClient`; every agent run behind an `Engine`
(the real one, `PiEngine`, embeds [`@earendil-works/pi-agent-core`] and intercepts
each tool call against the node's blast radius *before* it touches disk). Tests are
fully hermetic: zero network calls, and `OPENROUTER_API_KEY` is never required to
build, typecheck, lint, run the mock demo, or dry-run the experiment. The real
benchmark — the one that needs an API key and real models — is run by you.

[`@earendil-works/pi-agent-core`]: https://github.com/earendil-works/pi

## How it works (the node lifecycle)

```
PENDING → PACKED → RUNNING → RECONCILING → GATING
                                              ├─ pass → COMMITTED   (git commit "node(<id>): pass")
                                              └─ fail → RESET       (git reset --hard last-green)
                                                         ├─ attempts < ladder → RUNNING (next rung)
                                                         └─ ladder exhausted → MISSION_HALTED
```

Each node gets only its brief + the files matched by `context_globs` — never
mission history or another node's transcript. Writes are checked against
`blast_radius` before execution. Reconcile (deterministic, no LLM) confirms every
claimed write shows up in the diff, nothing changed outside the radius, and flags
*confabulation* when the model claims a check ran with no matching command. The
gate is the node's `done_check`, judged purely by exit code. A pass commits; a
fail resets and climbs the escalation ladder: executor → executor+failure-context
→ fallback → knight (frontier). Budgets are hard stops, checked after every call.

## Install

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm build        # compiles src → dist (needed for the `squire` binary)
pnpm test         # 74 tests, hermetic, no network
```

## The two commands that matter

### `squire run` — execute one mission

```bash
node dist/cli.js run examples/demo.yaml --mock
```

Runs a mission end-to-end. `--mock` uses the scripted `MockEngine` (no LLM, real
git ops in a temp sandbox) — this is the 3-node demo that exercises
pack → run → reconcile → gate → checkpoint for real. Drop `--mock` for a real run
(needs `OPENROUTER_API_KEY`); add `--chain <name>` to override the mission's chain.
If the workdir isn't a git repo it's copied into a throwaway temp repo, so your
source tree is never mutated. `squire trace <file>` pretty-prints any trace.

### `pnpm experiment` — the benchmark (the whole point)

```bash
pnpm experiment --dry-run                      # validate all fixtures + missions, print schema (no API key)
pnpm experiment --mock                         # self-run all 10 tasks x 2 chains offline (proves the suite)
pnpm experiment --tasks 1..10 --chains cheap,knight-only   # the real run (needs OPENROUTER_API_KEY)
```

Each task × chain runs in a fresh fixture copy under a temp git repo. Output is a
printed table, `results/experiment-<ts>.csv`, and a three-line verdict:

```
cheap-chain completion: X/10 missions, N% of nodes
escalation rate: n node(s) hit rung>=3
cost: $cheap vs $knight  (ratio)
```

`squire derive "<goal>"` is a convenience planner (one frontier call → a
`mission.yaml`); the benchmark deliberately uses hand-written missions.

## Pinning real model slugs

`chains.yaml` is **user-maintained config, not code.** It ships with placeholder
slugs and prices; pin real OpenRouter slugs and per-million-token prices before a
real run:

```yaml
chains:
  cheap:
    executor: "qwen/qwen3-coder"        # ← replace with the real slug you want
    fallback: "deepseek/deepseek-chat"  # ← second cheap model
    knight:   "anthropic/claude-opus-4" # ← frontier escalation target
  knight-only:
    executor: "anthropic/claude-opus-4"
    fallback: "anthropic/claude-opus-4"
    knight:   "anthropic/claude-opus-4"
prices:   # per MILLION tokens — drives budget.ts and the cost column
  "qwen/qwen3-coder":        { in: 0.20, out: 0.80 }
  "deepseek/deepseek-chat":  { in: 0.14, out: 0.28 }
  "anthropic/claude-opus-4": { in: 15.0, out: 75.0 }
```

The harness never invents a price: a slug missing from `prices` simply costs $0 in
the meter. Set `OPENROUTER_API_KEY` in your environment for real runs
(`OPENROUTER_BASE_URL` optional). The `cheap` vs `knight-only` chains are what the
verdict compares.

## Layout

`src/contract` (zod schemas + derive) · `src/engine` (Engine interface, PiEngine,
MockEngine, the ToolExecutor that owns every write) · `src/harness` (runner,
context pack, gates, checkpoint, reconcile, budget, escalate, trace) ·
`src/llm` (LlmClient + OpenRouter) · `tasks/01..10` (the benchmark) ·
`scripts/experiment.ts` (the table). See `SPEC.md` for the design authority,
`ENGINE_NOTES.md` for the pi-mono audit, and `ASSUMPTIONS.md` for decisions made
where the spec was silent.
