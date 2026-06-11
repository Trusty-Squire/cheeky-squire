# STATE.md

## v0.1 — done (all six gates, real benchmark run)
- Harness + real PiEngine + derive + 10-task benchmark. Cheap chain matched
  opus 25/25 nodes at ~31x lower cost (RESULTS.md). Found+fixed the unbounded
  max_tokens bug live.

## v0.1.1 — done (ablation + hard benchmark), all gates green
- Phase A — trace audit: finding #0 (traces weren't archived → now archived to
  results/<runId>/<task>-<chain>.jsonl). Adversarially audited 08/09/10; found +
  fixed 11 gameable gates across 03/05/06/08/09/10 (varied-input behavior gates,
  fail-against-stub for tests-first, mutation guards for write-test nodes).
  AUDIT.md records findings + verdict; every null solution re-verified blocked.
- Phase B — ablation: `--harness off` raw mode (one goal-only attempt, then
  score every node's done_check; no nodes/gates/checkpoints/blast/escalation) +
  `cheap-raw` chain alias + chain.harness schema field + demo raw gate (4b).
- Phase C — tasks 11–20 (hard): long-horizon consistency (8), 50-file localize,
  12+ call-site migration, poisoned dependency (caught at node 4, verified),
  ambiguous-brief-by-SPEC, test-first pair, two-package workspace (10), perf
  gate, dependency upgrade + lockfile, 15-node mega-mission. Each: fixture +
  mission + README (failure mode) + anti-gaming gates + reference mock scripts.
  All pass --mock 100% (54 nodes). scripts/calibrate.ts (live, human-run;
  flags any task ≥90% complete).
- Phase D — experiment.ts: 20 tasks × {cheap-raw, cheap, knight-only}; columns
  recovered/rungHist/confab/blastBlocks/trace; verdict leads with the ablation
  delta + cost per COMPLETED mission. --dry-run validates 20 fixtures + 3-chain
  schema. --mock defaults to the two scripted chains (raw is a live ablation).
- Phase E — CLAUDE.md success contract updated (gate 4b raw demo; gate 5 = 20
  tasks + 3-chain schema). README: three-column placeholder table + ablation
  methodology. All 7 checks green (1 test, 2 typecheck, 3 lint, 4 demo, 4b raw
  demo, 5 dry-run, 6 no-network).

## Blocked
- none

## Next (handed to the human)
- `pnpm experiment --tasks 1..20` (full matrix, ~live) for the real v0.1.1 table,
  and `pnpm calibrate --tasks 11..20 --chain cheap` to confirm the hard tasks
  actually separate cheap-raw from cheap. Fill the README placeholder table from
  the results.
