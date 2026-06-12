# DOGFOOD.md — the harness builds a feature on its own repo

2026-06-12. First real-project use: a hand-written 4-node mission
(`missions/squire-validate.yaml`) ran the cheap chain against this repository
itself, in place, on a branch — and shipped `squire validate`. Total model cost
across both attempts: **~$1.35**. Every gate was real: the full vitest suite,
strict `tsc`, eslint, build, and a live smoke run of the compiled CLI.

## The feature it built

`squire validate <mission.yaml> [--chains <file>]` — pre-flights a mission
before any tokens are spent: schema errors, unknown chains, `context_globs`
matching no files (warn), empty `blast_radius` (error). Exit 0 = valid.
Built test-first: node 1 wrote the suite, node 2 implemented against it,
node 3 wired the CLI, node 4 documented it.

## Run 1 — HALTED, and the halt was correct ($1.17)

Node 1 (qwen, rung 1) wrote a test suite containing a fixture bug:
`writeFileSync` into a temp subdirectory it never `mkdirSync`'d. The suite
failed against the stub — which is all the original gate required — so the
node PASSED, and the poisoned artifact was committed. Node 2 was then
**unsatisfiable**: the suite crashes with ENOENT before the implementation is
ever exercised. qwen, deepseek, and opus each did plausible-correct work and
failed the gate; the ladder exhausted; the mission halted.

What the harness did right under impossible conditions:

- **Blast radius held**: every rung was structurally prevented from "fixing"
  the test file (it lay outside `src/contract/**`), so no model could paper
  over the poison.
- **No confabulation**, clean halt at the last green checkpoint, and the trace
  pinpointed the root cause in one read (`ENOENT … src/dummy.txt` at the
  fixture line). Diagnosis took two minutes *because* of the trace.

This is the task-14 "poisoned dependency" failure mode appearing organically
in real use. **Lesson (mission authoring): gates on artifact-producing nodes
must validate the artifact's quality, not its existence.** "Tests fail against
the stub" is necessary but not sufficient — a *broken* suite also fails. The
fix, now in the mission: the failure output must contain the missing-module
error (`Failed to load url`) and must NOT contain `ENOENT`.

## Run 2 — COMPLETED, 4/4 nodes, all rung 1, $0.15

| node | result | rung | blast denials | cost |
|---|---|---|---|---:|
| write-tests | pass | 1 | 0 | $0.007 |
| implement | pass | 1 | 0 | $0.022 |
| wire-cli | pass | 1 | 1 (recovered in-attempt) | $0.147 |
| docs | pass | 1 | 0 | $0.151 (cum.) |

## Code review — one latent bug the gates missed

The agent wrote `import * as fg from "fast-glob"`. That works under
**vitest** (vite's ESM interop) but yields a non-callable namespace in the
**compiled ESM dist** — `fg.sync is not a function` at runtime. The agent's
own defensive try/catch then downgraded the breakage to per-glob *warnings*,
and the smoke gate asserted only **exit code 0** — so the node passed with the
glob checker dead in production.

Fixed by hand (default import). Two reusable lessons:

1. **Test-runner-green ≠ production-green.** Interop divergence between the
   test pipeline and the compiled artifact is invisible to suite-only gates.
   CI now runs a dist-smoke step asserting warning-free *output* on a
   known-good mission.
2. **Smoke gates must assert output content, not just exit codes** —
   especially because defensively-written code converts breakage into
   warnings that exit 0.

## Verdict on real-project readiness

The core machinery (gates, checkpoints, blast radius, ladder, trace) held up
under genuine failure — the halt was correct and the trace made diagnosis
cheap. The bottleneck, confirmed twice in one afternoon, is **mission
authoring**: writing gates is a skill, weak gates pass poisoned artifacts, and
exit-code-only smoke checks miss masked breakage. Code quality from the cheap
chain was genuinely decent (reused project parsers, sane error conversion) —
but human review still caught a shipped-broken path the gates did not.

**Usable today as a power tool with review; not yet an autonomous teammate.**
