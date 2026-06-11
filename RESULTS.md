# Benchmark results — Cheeky Squire v0.1

Real run on live OpenRouter, 2026-06-11. 10 tasks / 25 nodes, two chains.
Reproduce with `pnpm experiment --tasks 1..10 --chains cheap` and
`--chains knight-only` (needs `OPENROUTER_API_KEY`; see chains.yaml for slugs).

|                          | cheap chain (`qwen/qwen3-coder`) | knight-only (`anthropic/claude-opus-4`) |
|--------------------------|----------------------------------|-----------------------------------------|
| missions completed       | **10 / 10**                      | **10 / 10**                             |
| nodes completed          | **25 / 25 (100%)**               | **25 / 25 (100%)**                      |
| escalations (rung ≥ 3)   | 0                                | 0                                       |
| confabulation flags      | 0                                | 0                                       |
| blast-radius denials     | 6 (all blocked, still completed) | 2 (all blocked, still completed)        |
| total wall time          | 1083 s                           | 816 s                                   |
| **total cost**           | **$0.0950**                      | **$2.8983**                             |

**Verdict: identical completion (100% of nodes, zero escalations to the
frontier) at ~31× lower cost** — $0.095 vs $2.90, a cost ratio of 0.033.

### Per-task cost (cheap vs opus)

| task | cheap $ | opus $ |
|------|--------:|-------:|
| 01-fix-failing-test           | 0.0014 | 0.0416 |
| 02-implement-pure-fn          | 0.0011 | 0.0627 |
| 03-add-fn-with-tests          | 0.0024 | 0.3679 |
| 04-extract-module             | 0.0038 | 0.1937 |
| 05-bug-localize               | 0.0024 | 0.0780 |
| 06-cli-flag                   | 0.0334 | 0.5587 |
| 07-schema-migration-callers   | 0.0139 | 0.3042 |
| 08-rename-api                 | 0.0086 | 0.4155 |
| 09-spec-tests-first           | 0.0105 | 0.2173 |
| 10-mini-mission               | 0.0176 | 0.6588 |

### Reading the result

For this task suite the cheap model never needed the escalation ladder — the
harness scaffolding (fresh per-node context, objective gates, git checkpoints,
blast-radius enforcement) was enough for `qwen3-coder` to match a frontier model
node-for-node. The escalation path, confabulation detector, and budget meters
are still exercised by the harness on every node; they simply never had to fire
for these tasks. A harder suite (or weaker executor) is where escalations and
confabulation flags would start separating the chains — that's the next
experiment.

### Notes from the run

- A real-run bug was found and fixed: PiEngine didn't bound output `max_tokens`,
  so providers pre-authorized their full max (Opus: 32k ≈ $2.40) and 402'd on a
  low-balance account. Now capped to 8192 tokens/call.
- Both models occasionally attempted out-of-blast-radius writes; the harness
  (marshal) denied every one and the nodes still passed — enforcement works on
  real models, not just mocks.
