# Benchmark results — Cheeky Squire

## v0.1.1 — ablation + hard benchmark (benchmark of record)

Live OpenRouter, 2026-06-11/12. 20 tasks (01–10 graded, 11–20 designed to hurt),
three chains. Reproduce:

```bash
pnpm experiment --tasks 1..20 --chains cheap-raw,cheap          # ablation (qwen)
pnpm experiment --tasks 1..20 --chains knight-only \
  --chains-file chains/knight-only-scaled.yaml                  # frontier baseline (opus, fair budgets)
```

| chain | completed | total cost | **$/completed mission** |
|---|---:|---:|---:|
| **cheap-raw** — harness OFF (`qwen/qwen3-coder`, one raw goal-only attempt) | 7 / 20 (35%) | $0.43 | $0.061 |
| **cheap** — harness ON (`qwen/qwen3-coder`) | **20 / 20** | $0.64 | **$0.032** |
| **knight-only** — frontier (`anthropic/claude-opus-4`, budgets scaled for opus) | **20 / 20** | $15.97 | **$0.80** |

### Two earned results

1. **The harness is the lift (ablation).** Same cheap model, same tasks, same
   budgets: completion goes **35% → 100%** purely from the scaffolding (fresh
   per-node context, objective gates, git checkpoints, blast-radius enforcement,
   structured-failure retry). And it did it on **same-model retries alone** —
   14 nodes failed rung 1 and were recovered at rung 2, with **zero escalations
   to the frontier** and zero confabulation flags. The cheap chain never paid
   frontier prices.

2. **Cheap-harnessed *matches* the frontier at ~25× lower cost.** Both chains
   complete **20/20**; opus costs **$0.80 per completed mission**, cheap+harness
   **$0.032** — a **~25× gap for identical completion**. You don't need the
   frontier model if the scaffolding gets the cheap one to the same place for 4%
   of the price.

### Per-task opus cost (scaled frontier baseline)

| task | nodes | opus $ | | task | nodes | opus $ |
|---|---:|---:|---|---|---:|---:|
| 01 | 1 | 0.0573 | | 11 | 8 | 1.2902 |
| 02 | 1 | 0.0582 | | 12 | 2 | 0.0985 |
| 03 | 2 | 0.3242 | | 13 | 3 | 0.4825 |
| 04 | 2 | 0.2395 | | 14 | 7 | 2.1568 |
| 05 | 2 | 0.0756 | | 15 | 2 | 1.0529 |
| 06 | 3 | 0.6174 | | 16 | 2 | 0.1997 |
| 07 | 3 | 0.4024 | | 17 | 10 | 2.3376 |
| 08 | 3 | 0.4973 | | 18 | 2 | 0.2845 |
| 09 | 3 | 0.1962 | | 19 | 3 | 0.5748 |
| 10 | 5 | 0.7655 | | 20 | 15 | 4.2569 |

### Methodology + honesty notes

- The `cheap`/`cheap-raw` rows are from one full three-chain matrix run; the
  `knight-only` row is a **re-run with budgets scaled 3× for opus pricing**
  (`chains/knight-only-scaled.yaml`). Why: the per-task budgets in
  `tasks/*/mission.yaml` were sized for a cheap model, so opus tripped them. The
  3× factor is **derived from the archived traces** — opus's real spend reached
  ~2.1× a node's cheap-sized cap on the heaviest nodes; +40% headroom → 3×.
- **A first, naive run made opus look like it failed 5 tasks (15/20).** That was
  wrong — every gate opus reached had passed (exit 0); the nodes were being
  killed by per-node dollar caps sized for a 50–75× cheaper model. Investigating
  rather than reporting it surfaced two real harness bugs, both fixed before this
  baseline:
  1. **Budget meter was model-blind:** a node whose gate *passed* was discarded
     and retried for exceeding its per-node cap. Fixed — a passed gate always
     commits (flagged `over_budget_committed` as a warning); the per-node cap now
     guards *starting another attempt*, the global cap is the hard stop.
  2. **Context bloat:** opus once emitted a 175K-token request on a trivial
     fixture (an unbounded tool output re-sent every turn). Fixed — tool output
     is clamped and the agent loop's history is bounded (`clampOutput` +
     `boundHistory`).
  With both fixed and budgets matched to its pricing, opus completes **20/20**.
- The `cheap` rows predate those fixes, but the fixes only *help*: `cheap` was
  already 20/20 with no frontier escalations and no context blowups, so its
  numbers are unchanged; the fixes would only *raise* `cheap-raw`, so its 7/20 is
  a conservative floor for the harness lift.

---

## v0.1 — first run (historical, 10 tasks)

Live OpenRouter, 2026-06-11. 10 tasks / 25 nodes, two chains.

|                          | cheap chain (`qwen/qwen3-coder`) | knight-only (`anthropic/claude-opus-4`) |
|--------------------------|----------------------------------|-----------------------------------------|
| missions completed       | **10 / 10**                      | **10 / 10**                             |
| nodes completed          | **25 / 25 (100%)**               | **25 / 25 (100%)**                      |
| escalations (rung ≥ 3)   | 0                                | 0                                       |
| confabulation flags      | 0                                | 0                                       |
| blast-radius denials     | 6 (all blocked, still completed) | 2 (all blocked, still completed)        |
| total wall time          | 1083 s                           | 816 s                                   |
| **total cost**           | **$0.0950**                      | **$2.8983**                             |

**Verdict: identical completion at ~31× lower cost** — $0.095 vs $2.90 (ratio
0.033). The v0.1 suite (tasks 01–10) was easy enough that the cheap model never
needed the ladder; v0.1.1's tasks 11–20 + the `cheap-raw` ablation are what
actually stress and separate the chains.

### Notes from the v0.1 run

- Found + fixed: PiEngine didn't bound output `max_tokens`, so providers
  pre-authorized their full max (Opus 32k ≈ $2.40) and 402'd on a low balance.
  Now capped to 8192 tokens/call.
- Both models occasionally attempted out-of-blast-radius writes; the harness
  denied every one and the nodes still passed — enforcement works on real
  models, not just mocks.
