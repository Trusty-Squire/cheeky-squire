# SPEC.md — Cheeky Squire v0.1

> A verification harness that lets cheap LLMs complete long
> multi-step coding tasks reliably. v0.1 is an experiment:
> the deliverable is a benchmark table proving (or killing)
> the thesis, not a polished product.

---

## 1. Thesis under test

Cheap models (Qwen, DeepSeek class) fail long tasks for four
scaffold-fixable reasons: context rot, silent failure,
error compounding, and format fragility. A harness that gives
each task-node a fresh minimal context, verifies every node
with an objective gate, checkpoints via git, and escalates to
a frontier model only on repeated failure should achieve
frontier-comparable completion rates at a fraction of the cost.

**The number that matters:** % of nodes completed by the cheap
chain without escalation, and total $ per completed mission,
versus a frontier-only chain on the same tasks.

---

## 2. Stack

- TypeScript, Node 20+, pnpm
- vitest (tests), zod (all schema validation), execa (shell),
  fast-glob (context packs), yaml (mission files)
- Engine: pi-mono packages by Mario Zechner (see §6 and
  Phase 0 audit requirement)
- LLM transport: pi-mono's unified provider API if suitable,
  else direct OpenRouter HTTP. Either way behind our own
  interface (§7).
- Binary name: `squire`. Package: `@cheekysquire/cli`.
- NO network calls in any test. Ever.

---

## 3. Repo layout

```
cheeky-squire/
  package.json
  tsconfig.json            # strict: true
  src/
    cli.ts                 # entry: run | derive | trace | experiment
    contract/
      schema.ts            # zod: Mission, Node, Gate, Chain, Budget
      derive.ts            # planner pass (frontier call -> Mission)
    engine/
      types.ts             # Engine interface + EngineEvent
      pi.ts                # PiEngine (pi-mono adapter)
      builtin.ts           # BuiltinEngine (fallback, see §6.3)
      mock.ts              # MockEngine (scripted, for tests/demo)
    harness/
      runner.ts            # mission executor (node state machine)
      context.ts           # context pack assembly
      gates.ts             # done_check execution
      checkpoint.ts        # git commit / reset per node
      reconcile.ts         # writes-vs-diff verification
      escalate.ts          # retry ladder
      budget.ts            # token/$ metering, hard stop
      trace.ts             # JSONL event log
    llm/
      types.ts             # LlmClient interface
      openrouter.ts        # impl (or thin wrapper over pi-mono)
      mock.ts              # MockLlm
      pricing.ts           # cost calc from chains.yaml prices
  chains.yaml              # named chains, pinned models, prices
  examples/
    demo.yaml              # 3-node mock mission
  tasks/                   # benchmark missions 01..10
    01-fix-failing-test/
      fixture/             # small repo, created by setup script
      mission.yaml
    ... (escalating difficulty, see §11)
  scripts/
    setup-fixtures.ts      # builds/initializes task fixture repos
    experiment.ts          # the whole point (see §12)
  test/                    # vitest, mirrors src/
  CLAUDE.md  SPEC.md  STATE.md  ASSUMPTIONS.md  ENGINE_NOTES.md
```

---

## 4. Mission schema (zod-validated)

```yaml
# mission.yaml
goal: "human-readable goal"
budget_usd: 2.50              # global HARD cap
chain: cheap                  # name from chains.yaml, CLI-overridable
workdir: "."                  # repo the mission operates on
nodes:
  - id: parse-config
    brief: >
      One-paragraph instruction for this node only.
      Written as if the executor knows nothing else.
    deps: []                  # node ids; DAG, no cycles
    context_globs:            # files packed into the node context
      - "src/config/**/*.ts"
      - "SPEC.md"
    blast_radius:             # writes allowed ONLY here
      - "src/config/**"
      - "test/config/**"
    done_check: "pnpm vitest run test/config"   # exit 0 = pass
    budget_usd: 0.40          # per-node cap
    max_context_tokens: 40000 # pack truncation limit
```

```yaml
# chains.yaml
chains:
  cheap:
    executor: "qwen/qwen3-coder"        # PLACEHOLDER SLUGS —
    fallback: "deepseek/deepseek-chat"  # user pins real ones
    knight:  "anthropic/claude-opus-4"  # escalation target
  knight-only:
    executor: "anthropic/claude-opus-4"
    fallback: "anthropic/claude-opus-4"
    knight:  "anthropic/claude-opus-4"
prices:   # per million tokens, used by budget.ts
  "qwen/qwen3-coder":       { in: 0.20, out: 0.80 }
  "deepseek/deepseek-chat": { in: 0.14, out: 0.28 }
  "anthropic/claude-opus-4":{ in: 15.0, out: 75.0 }
```

Model slugs and prices are USER-MAINTAINED config, not code.
Implement with placeholders; do not attempt to verify slugs.

---

## 5. Node lifecycle (the core state machine)

```
PENDING → PACKED → RUNNING → RECONCILING → GATING
                                              ├─ pass → COMMITTED (git commit "node(<id>): pass")
                                              └─ fail → RESET (git reset --hard last-green)
                                                         ├─ attempts < ladder → RUNNING (next rung)
                                                         └─ ladder exhausted → MISSION_HALTED
```

Rules:
1. A node runs only when all `deps` are COMMITTED.
2. PACKED: assemble context = system prompt + node brief +
   contents of context_globs (truncate to max_context_tokens,
   newest-file-first on overflow, record truncation in trace).
   The node NEVER sees mission history, other nodes' output,
   or prior attempts' transcripts (except via the failure
   context injected on retry rung 2+, see §9).
3. RUNNING: engine executes with the chain's current-rung model.
4. Mid-run enforcement: every write/edit tool call is checked
   against blast_radius BEFORE execution. Violation → tool call
   denied, structured error injected as the tool result, run
   continues. 3 violations in one attempt → attempt fails.
5. RECONCILING: deterministic checks, no LLM:
   - every write/edit the engine executed appears in `git diff`
   - no diff outside blast_radius
   - if engine's final message claims tests ran, a bash tool
     call matching the done_check command (or test/lint/build
     pattern) must exist in the attempt trace; else mark
     `confabulation_flag` in trace (do not fail the node for
     it — the gate decides — but COUNT it; it is a thesis metric)
6. GATING: run done_check via execa, cwd=workdir, 5 min timeout.
   Exit 0 = pass. Capture stdout/stderr tails (4KB) to trace.
7. Budget check after every LLM call: node and global meters.
   Node cap hit → attempt fails (rung advances). Global cap
   hit → MISSION_HALTED immediately, state preserved.

---

## 6. Engine layer

### 6.1 Interface (nothing above this line knows about pi)

```ts
export interface Engine {
  runAttempt(req: AttemptRequest): AsyncIterable<EngineEvent>;
}

export interface AttemptRequest {
  systemPrompt: string;
  brief: string;
  files: PackedFile[];          // path + contents
  cwd: string;
  model: ModelRef;              // slug + api key + base url
  tools: ToolPolicy;            // blast_radius globs, denylist
  maxTokens: number;
}

export type EngineEvent =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: ToolName; args: unknown }
  | { kind: "tool_result"; id: string; ok: boolean; output: string }
  | { kind: "usage"; inTokens: number; outTokens: number }
  | { kind: "done"; finalMessage: string }
  | { kind: "error"; message: string };

export type ToolName = "read" | "write" | "edit" | "bash";
```

The harness consumes this stream; PiEngine produces it.
Blast-radius enforcement lives in the HARNESS (it wraps the
tool execution callback if pi exposes one, or filters events
if pi pre-executes — Phase 0 determines which; prefer
pre-execution interception).

### 6.2 PiEngine — Phase 0 audit REQUIRED before implementing

pi-mono's exact API is NOT specified here because it must be
read from source, not assumed. Phase 0 (see GOAL prompt):
install the pi-mono packages, read their READMEs and types,
and write ENGINE_NOTES.md documenting: package names, how to
construct an agent session programmatically, how tool
execution is intercepted/customized, how provider/model is
selected, how usage tokens are reported, and how reasoning
trace fields (e.g. DeepSeek reasoning_content) are handled.
Then implement PiEngine against the REAL API.

### 6.3 BuiltinEngine — the contingency

If Phase 0 concludes pi-mono cannot be embedded as a library
with tool interception (record the finding in ENGINE_NOTES.md
with evidence), implement BuiltinEngine instead: a minimal
agent loop — chat completion with 4 tool definitions, execute
tool calls locally (read/write/edit via fs, bash via execa),
append results, repeat until no tool calls or maxTokens.
Use pi-mono's provider/LLM package alone if importable;
else openrouter.ts. This is ~300 lines, not a project.
PiEngine can become a later PR. Do not stall on this decision:
timebox Phase 0 to one focused pass, decide, record, proceed.

### 6.4 MockEngine

Replays a scripted EngineEvent sequence from a JSON file.
Used by all tests and `--mock` runs. Scripts live in
test/fixtures/engine-scripts/. The demo mission's three nodes
each have a script that performs real file writes via the
harness tool executor (so reconcile/gates/checkpoint paths are
exercised for real) but no LLM call occurs.

---

## 7. LlmClient (planner + any non-engine calls)

```ts
export interface LlmClient {
  complete(req: { model: string; system: string; user: string;
                  json?: boolean; maxTokens: number }):
    Promise<{ text: string; inTokens: number; outTokens: number }>;
}
```
OpenRouter impl: POST /api/v1/chat/completions, OPENROUTER_API_KEY
from env, 2 retries with backoff on 429/5xx. MockLlm for tests.

---

## 8. Planner pass (`squire derive "<goal>"`)

One frontier call (chain's knight model) that turns a goal +
repo survey into a mission.yaml.

Inputs assembled by derive.ts: the goal string; `git ls-files`
output; contents of any README/package.json/Cargo.toml found;
detected check commands (test/lint/build scripts from
package.json or Makefile).

System prompt (verbatim, appendix A) instructs: decompose into
3–12 nodes; every node MUST have a done_check that is a real
runnable command; prefer existing test/build commands; write
self-contained briefs; assign tight blast_radius; output ONLY
JSON matching the provided schema. Response is zod-validated;
on failure, ONE retry with the validation errors appended;
second failure → exit with error (no silent fallback).

Output: mission.yaml written to disk + the four-line readback
printed (done-when summary, budget, blast radius, chain) +
`proceed? [y/N]` unless `--yes`.

v0.1 boundary: derive is a convenience. The benchmark tasks
use HAND-WRITTEN mission.yaml files so the experiment measures
the harness, not the planner.

---

## 9. Escalation ladder (escalate.ts)

Per node, in order, each attempt preceded by git reset to
last green checkpoint:

| rung | model            | context addition                    |
|------|------------------|-------------------------------------|
| 1    | chain.executor   | none (clean)                        |
| 2    | chain.executor   | FAILURE CONTEXT block               |
| 3    | chain.fallback   | FAILURE CONTEXT block               |
| 4    | chain.knight     | FAILURE CONTEXT + prior diff        |
| 5    | —                | MISSION_HALTED, full report printed |

FAILURE CONTEXT block (structured, built by harness, never
free prose from the failed model): gate command, exit code,
stderr tail, reconcile violations, confabulation_flag, and
"what the previous attempt changed" as a file list. The failed
attempt's transcript is NOT carried forward.

Every rung transition is a trace event with cost so far.

---

## 10. Trace (trace.ts)

Append-only JSONL at .squire/trace-<missionId>.jsonl.
Every event: ts, missionId, nodeId, attempt, rung, kind,
payload, costUsdSoFar. Event kinds: mission_start, node_start,
pack, tool_call, tool_result, blast_denied, usage, reconcile,
confabulation_flag, gate, checkpoint, reset, escalate,
budget_stop, node_pass, node_fail, mission_end.
`squire trace <file>` pretty-prints a summary (plain text,
no TUI): per-node table + totals. Keep it boring.

---

## 11. Benchmark tasks (tasks/01..10)

Each task: a fixture repo (built by scripts/setup-fixtures.ts —
plain TS/JS micro-projects with real vitest suites, committed
as files not submodules), a hand-written mission.yaml, gates
that are genuinely objective. Escalating difficulty:

01 fix one failing unit test (1 node)
02 implement a pure function from a failing test file (1 node)
03 add a function + write its tests, coverage gate (2 nodes)
04 small refactor: extract module, all tests stay green (2 nodes)
05 fix a bug requiring reading 3 files to localize (2 nodes)
06 add a CLI flag end-to-end: parse, behavior, tests (3 nodes)
07 dependency-ordered chain: schema change → migration →
   callers updated (3 nodes, real deps between them)
08 cross-file rename/API change with a compile gate (3 nodes)
09 implement a small feature from a SPEC paragraph, tests
   written first by node 1, implementation by node 2 (3 nodes)
10 mini-mission: 5 nodes, mixed — the long-horizon stressor

Design tasks so done_checks cannot be gamed by deleting tests:
gates include `git diff --stat` guards where needed (e.g.
"test file unchanged": `git diff --quiet -- test/target.test.ts`).

---

## 12. The experiment (scripts/experiment.ts)

`pnpm experiment [--tasks 1..10] [--chains cheap,knight-only]
[--dry-run]`

For each task × chain: fresh fixture copy in a temp dir,
git init + commit, run the mission, collect from trace:
completed (bool), nodes passed, escalations by rung,
confabulation_flags, retries, wall seconds, cost USD.

Output: results/experiment-<ts>.csv + a printed table +
a three-line verdict footer:
  cheap-chain completion: X/10 missions, N% of nodes
  escalation rate: n nodes hit rung>=3
  cost: $cheap vs $knight  (ratio)

`--dry-run`: validates all missions + fixtures, prints the
empty table schema, exits 0. THIS is gate #4 — the real run
needs an API key and is performed by the human.

---

## 13. Out of scope for v0.1 (building these = drift)

TUI/colors beyond plain status lines · `squire watch` ·
the init wizard · Goose/ACP · admission probes · bandit
routing · voting · community telemetry · medieval-voice
agent personas (vocabulary reserved: herald=planner,
marshal=blast enforcement, knight=escalation — fine to use
these as internal identifiers, build no persona features).

---

## Appendix A — planner system prompt (derive.ts, verbatim)

```
You are the Herald: a mission planner for a verification
harness. You will receive a goal and a repository survey.
Decompose the goal into 3-12 nodes forming a DAG.

Rules:
- Every node MUST have done_check: a single shell command,
  runnable in this repo, that exits 0 only if the node's
  work is objectively complete. Prefer the repo's existing
  test/build/lint commands. Never invent commands.
- Briefs are self-contained: the executor sees ONLY the brief
  and the files matched by context_globs. No references to
  "as discussed" or other nodes' reasoning.
- blast_radius: the narrowest glob set that permits the work.
- Budgets: distribute the mission budget; harder nodes more.
- If the goal cannot be decomposed into objectively checkable
  nodes, output {"error": "<one sentence why>"} instead.

Output ONLY JSON matching the schema provided. No markdown.
```

## Appendix B — executor system prompt (runner.ts, verbatim)

```
You are a Squire: a focused coding agent executing ONE task.
You have four tools: read, write, edit, bash.
Work only within the paths you are told are writable.
Run the check command yourself before declaring done; if it
fails, fix and re-run. Declare done only when it exits 0.
Your final message: one short paragraph stating what changed
(file list) and the check result. Claim nothing you did not do;
your tool calls are audited against your claims.
```
