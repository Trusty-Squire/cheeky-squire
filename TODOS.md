# TODOS.md — implement next

## 1. Credential-free runtime: Trusty Squire injecting proxy
ser never holds an API key. A local proxy (`squire proxy openrouter.ai` →
`http://localhost:XXXX/api/v1`) injects Authorization at the boundary from
the Trusty Squire vault, enforces allowed-hosts, and meters every token of
spend per loop. ser already honors `OPENROUTER_BASE_URL`, so the harness
side is nearly free:
- [ ] ser: accept a base URL with no key present (today NO_API_KEY throws
      before the engine starts; with a proxy base URL the key check must
      relax — proxy authenticates, not ser)
- [ ] ser: surface proxy spend headers (if present) in the trace/budget
      meter instead of price-table arithmetic when available
- [ ] squire side (separate repo): local proxy command — vault-backed
      Authorization injection, allowed-hosts, per-request spend ledger
- [ ] docs: "ser without secrets" setup path
Why it fits the thesis: loops spend money unattended; the credential
boundary and the spend meter belong in the substrate, not the agent
(H4 control-substrate research; budget-meters-are-hard-stops invariant).

## Parked behind it (v0.3 candidates, in thesis order)
- Standing-loop runtime: triggers, queue, recurring missions (the
  centerpiece — loops as the product).
- Leaderboard/referee harness.
