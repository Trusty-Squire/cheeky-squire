# STATE.md

## Done
- Phase 0: pi-mono audit → ENGINE_NOTES.md, DECISION: PiEngine feasible.
- Phase 1: harness core (schema, trace, gates, checkpoint, context, reconcile,
  budget, escalate, ToolExecutor, MockEngine, runner, cli) + demo. Gate 4 green.
- Phase 2: real PiEngine via @earendil-works/pi-agent-core, blast-radius
  interception, tested network-free (injected streamFn) + through runMission.
- Phase 3: derive (verbatim Herald prompt, retry-once, refusal path) + LLM layer
  (LlmClient, MockLlm, OpenRouterClient, pricing).
- Phase 4: benchmark suite — 10 tasks (01..10) with hand-written missions,
  ungameable node:test/git-diff gates, mock engine-scripts; scripts/experiment.ts
  + setup-fixtures.ts. `pnpm experiment --mock` completes all 10 tasks x 2 chains
  (100% nodes). Gate 5 (`pnpm experiment --dry-run`) green.

## In progress
- Phase 5: close — run all six gates, write README.md, final commit.

## Blocked
- none

## Next
- Six-gate sweep, README, final STATE update.
