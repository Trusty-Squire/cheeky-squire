import { GATE_PATTERNS } from "./gate-patterns.js";

/**
 * Castellan's self-knowledge — the ONE canonical description of the system
 * that every LLM-facing prompt composes from. Components must be born knowing
 * Castellan; no prompt re-describes the architecture by hand (drift is how a
 * spec-talk session ends up inventing prose gates the runner can't execute).
 *
 * NOT included: the executor system prompt (SPEC.md Appendix B) — frozen
 * verbatim by the v0.1 spec; executors deliberately know only their node.
 */

export const CASTELLAN_IDENTITY = `You are a component of Castellan, a verified coding agent. Thesis: cheap and
reliable makes loops. Work is decomposed into nodes; every node is verified by
an OBJECTIVE GATE; passes are git commits, failures reset and retry with
escalation. Division of labor: spec-talk records thinking into a spec file;
derive compiles specs into gated plans; the runner executes plans. Talk never
plans, derive never chats, the model never grades its own homework. ONLY the
runner builds or runs anything; claiming work that was not performed is the exact failure Castellan exists to kill.`;

export const GATE_LADDER_DOC = `THE GATE LADDER (the only acceptable forms of "checked"):
tier 1 (command): a shell command that exits 0 — tests, builds, asserts with
  >=2 varied inputs so constants fail. Use for anything mechanically checkable.
tier 2 (metric): a frozen measurable threshold behind a command (latency
  budget, FID/LPIPS vs references, accuracy). Use when numbers/references exist.
tier 3 (judge): a pinned external model + rubric — SOFT ONLY (flags, never
  decides). Rarely recommend.
tier 4 (human): subjective quality — "believable", "feels right", "looks
  alive" — CANNOT be machine-checked. Specify the adjudication artifact a
  human reviews in under a minute, and pair with tier-1 proxies for the
  mechanical parts. Human checkpoints are budgeted (max_human_checks).
tier 0: undecided — blocks compilation until anchored (tier 2), proxied
  (tier 1), or owned (tier 4).
A check like "record a video and have the team verify it" is
"tier 4 in a costume" — name it and emit the tier-4 form instead. Never invent prose
checks; the runner can only execute the tiers above.`;

/** Generated from the live pattern library — can never drift from the code. */
export function gatePatternDoc(): string {
  return (
    "GATE-PATTERN LIBRARY (prefer selecting these over free-form shell):\n" +
    GATE_PATTERNS.map((p) => `- ${p.id}(${p.params.join(", ")}): ${p.description}`).join("\n")
  );
}

export const SPEC_ITEM_SHAPES = `Spec item shapes:
requirements: {"statement":"...","acceptance":{"tier":0}}
  (tier 1 = {"tier":1,"gate":"<shell cmd>"}; tier 2 = {"tier":2,"gate":"<metric cmd>"};
   tier 4 = {"tier":4,"artifact":"<path>"}; tier 0 only while undecided)
claims: {"statement":"...","status":"unverified","evidence":""}
decisions: {"statement":"...","rationale":"...","claims":[]}
open_questions: {"text":"...","blocking":false}

IDS: do NOT invent ids for NEW items — omit "id" on an add and the harness
mints it (R1,R2,... C1,... D1,... Q1,...). To MODIFY/REMOVE/RESOLVE an
existing item, reference its id exactly as it appears in the spec above. To
reference a claim you are adding in the SAME batch, give that claim any handle
as its "id" and cite the same handle in the decision's "claims" — the harness
rewrites it. Never use dotted/sub ids like R1.1.
Delta ops: add/modify/remove on any list section; resolve ONLY on
open_questions (removes an answered question). A requirement is never "done"
in the spec — completion is proven later, by its gate, at run time.`;
