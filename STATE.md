# STATE.md

## Done — all phases complete, all six gates green
- Phase 0: pi-mono audit → ENGINE_NOTES.md, DECISION: PiEngine feasible
  (@earendil-works/pi-{ai,agent-core}).
- Phase 1: harness core (schema, trace, gates, checkpoint, context, reconcile,
  budget, escalate, ToolExecutor, MockEngine, runner, cli) + 3-node demo.
- Phase 2: real PiEngine via pi-agent-core with blast-radius interception;
  tested network-free (injected streamFn) and through runMission.
- Phase 3: derive (verbatim Herald prompt, schema-retry-once, refusal path) +
  LLM layer (LlmClient, MockLlm, OpenRouterClient, pricing).
- Phase 4: 10 benchmark tasks with ungameable node:test/git-diff gates + mock
  engine-scripts; scripts/experiment.ts + setup-fixtures.ts.
- Phase 5: six-gate sweep green, README.md written, final commit.

## Six-gate status (verified, no OPENROUTER_API_KEY)
1. pnpm test ............ 74 tests pass
2. pnpm typecheck ...... clean
3. pnpm lint ........... clean
4. node dist/cli.js run examples/demo.yaml --mock ... exit 0
5. pnpm experiment --dry-run ........................ exit 0
6. zero network in tests; no API key required for 1-5
   (bonus: `pnpm experiment --mock` self-runs all 10 tasks x 2 chains at 100%)

## Blocked
- none

## Next (handed to the human)
- Pin real OpenRouter slugs/prices in chains.yaml, set OPENROUTER_API_KEY, and run
  `pnpm experiment` to produce the real benchmark table (the thesis measurement).
