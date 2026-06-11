# STATE.md

## Done
- Phase 0: pi-mono audit. Verified maintained packages
  `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`, read their
  types, wrote ENGINE_NOTES.md. DECISION: **PiEngine feasible**.
- Project scaffold: package.json, deps installed.

## In progress
- Phase 1: harness core (mock-first), commit order
  schema → trace → gates → checkpoint → context → reconcile → budget →
  escalate → MockEngine → runner → cli.

## Blocked
- none

## Next
- Scaffold tsconfig/eslint/vitest, then `src/contract/schema.ts`.
