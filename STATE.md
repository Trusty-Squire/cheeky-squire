# STATE.md

## v0.1 / v0.1.1 — done
Harness, real engine, 20-task benchmark, ablation (35%→100%), opus parity at
~1/25th cost (RESULTS.md), audit + hardened gates, rebrand to Castellan
(binary `ser`), thesis: cheap and reliable makes loops.

## v0.2 — planning layer BUILT (this session); live measurements pending
Per SPEC-v0.2:
- Gate ladder: schema v2 (gate objects, max_human_checks), executeGate for all
  four tiers — human gates pause/record/escalate (success gate #5 ✅ via
  tests), judge soft-only with judge_flag.
- Gate-pattern library: 10 patterns, each citing the measured failure that
  created it; renders validate against GateSchema.
- derive-v2 herald pipeline: 7 stages, spec-acceptance-wins gate inference,
  adversarial lenses w/ evidence-required refutations, tier-0 refusal w/ 3
  remediations, --judge mode. CLI routed.
- ser spec: spec.yaml schema + SpecSession delta loop (bounded context proven
  by test, git-checkpointed accepts, rejection-escalation), checkSpec gates,
  verifyClaim lenses. CLI: init|check|verify|talk.
- ser do / ser fix mission packs (mechanical, refuse-if-ungated).
- Benches built (not run live): derive-bench (planner tax), poker-bench
  (5 infeasible + 2 controls), gate-attack (hermetic; 0 fails on tasks 1-5,
  1 legit warn on the refactor task).
- Unified interface: `ser talk` — one conversation across all tools; the
  mapper requests harness commands via an `action` field (check/verify/
  derive/run/status), the harness executes mechanically and reports (A28).
- 149 hermetic tests; zero network; CI green.

## Live runs pending (human/key)
1. Cross-executor gauntlet — RUNNING in background (glm/kimi/deepseek × 20
   tasks; flawless through ~task 9 at last check). Results → RESULTS.md +
   pillar-3 wording per SPEC-v0.2 §9.6.
2. `pnpm derive-bench --tasks 1..20` — the planner tax (THE v0.2 bet).
3. `pnpm poker-bench` — refusal quality.
4. ser spec dogfood (success gate #4): write the v0.3 leaderboard spec with
   `ser spec talk`.

## Next
Run live gates 2-3 above; then v0.3 centerpiece per thesis: the standing-loop
runtime (triggers, queue, recurring missions).
