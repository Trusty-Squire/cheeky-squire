# STATE.md

## Done
- Phase 0: pi-mono audit → ENGINE_NOTES.md, DECISION: PiEngine feasible.
- Phase 1: harness core (mock-first), all modules in SPEC commit order:
  schema, trace, gates, checkpoint, context, reconcile, budget, escalate,
  ToolExecutor, MockEngine, runner, cli (run + trace). chains.yaml + demo
  mission + fixture + engine scripts.
  - Gate 4 PASSES: `node dist/cli.js run examples/demo.yaml --mock` runs a
    3-node mission end-to-end (real git in a temp dir), exit 0.
  - 54 tests green, typecheck clean, lint clean.

## In progress
- Phase 2: real PiEngine (src/engine/pi.ts) via @earendil-works/pi-agent-core,
  with blast-radius interception. (pi.ts is currently a throwing placeholder.)

## Blocked
- none

## Next
- Phase 2 PiEngine + interception tests → Phase 3 derive → Phase 4 fixtures +
  experiment → Phase 5 close (six gates + README).
