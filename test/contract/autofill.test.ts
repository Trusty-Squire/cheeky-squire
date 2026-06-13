import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autofillSpec } from "../../src/contract/autofill.js";
import { parseSpec } from "../../src/contract/spec.js";
import { MockLlm, type MockLlmResponse } from "../../src/llm/mock.js";

// Mechanically clean (2 gated reqs + scope) — so only the LLM diagnostician
// can pull the score down, and a fill can bring it back up. Deterministic.
const cleanSpec = `
thesis: "a fox companion for kids"
scope_fence:
  - "offline only"
  - "no open web"
requirements:
  - id: R1
    statement: "voice loop"
    acceptance: { tier: 1, gate: "node --test loop" }
  - id: R2
    statement: "safe content"
    acceptance: { tier: 4, artifact: "review.md" }
`;

const diag = (improvements: unknown[]): MockLlmResponse => ({ text: JSON.stringify({ improvements }) });
const fill = (deltas: unknown[]): MockLlmResponse => ({ text: JSON.stringify({ deltas }) });

let dir: string;
let specPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "autofill-"));
  specPath = join(dir, "x.spec.yaml");
  writeFileSync(specPath, cleanSpec);
});

describe("autofillSpec", () => {
  // Two major gaps (-30) put a mechanically-clean spec below the 85 bar; the
  // model can no longer mark anything "blocking" (clamped to major in code).
  it("closes model-flagged gaps and reaches build-ready", async () => {
    const llm = new MockLlm([
      diag([
        { dimension: "gate-strength", severity: "major", problem: "R1 gate passes on a stub", suggestion: "assert varied inputs", needsUser: false },
        { dimension: "coverage", severity: "major", problem: "no error-path requirement", suggestion: "add one", needsUser: false },
      ]),
      fill([{ section: "requirements", op: "modify", id: "R1", value: { id: "R1", statement: "voice loop", acceptance: { tier: 1, gate: "node --test loop --varied" } }, drift: false }]),
      diag([]), // gaps closed
    ]);
    const r = await autofillSpec(specPath, llm, "m");
    expect(r.reachedReady).toBe(true);
    expect(r.applied.length).toBeGreaterThan(0);
    expect(r.rounds).toBe(1);
    expect(readFileSync(specPath, "utf8")).toContain("--varied");
  });

  it("defaults a genuine fork and records it as a visible 'ser default:' decision", async () => {
    const llm = new MockLlm([
      diag([
        { dimension: "hardware", severity: "major", problem: "no target runtime", suggestion: "pick a platform", needsUser: true },
        { dimension: "persistence", severity: "major", problem: "no persistence requirement", suggestion: "add one", needsUser: false },
      ]),
      fill([{ section: "decisions", op: "add", value: { id: "D1", statement: "ser default: target an offline phone app", rationale: "most accessible for a parent", claims: [] }, drift: false }]),
      diag([]),
    ]);
    const r = await autofillSpec(specPath, llm, "m");
    expect(r.defaults.some((d) => /ser default: target an offline phone/.test(d))).toBe(true);
    expect(parseSpec(readFileSync(specPath, "utf8"), specPath).decisions[0]!.statement).toContain("ser default");
  });

  it("stops (not ready) when the model can produce no fix — surfaces to the user", async () => {
    const llm = new MockLlm([
      diag([
        { dimension: "hardware", severity: "major", problem: "unresolvable fork", suggestion: "?", needsUser: true },
        { dimension: "scope", severity: "major", problem: "scope undefined", suggestion: "?", needsUser: true },
      ]),
      fill([]), // no deltas — cannot make progress
    ]);
    const r = await autofillSpec(specPath, llm, "m");
    expect(r.reachedReady).toBe(false);
    expect(r.rounds).toBe(0);
    expect(r.finalScore.improvements.some((i) => i.needsUser)).toBe(true);
  });

  it("splitting a coarse requirement removes the original so it is not re-flagged", async () => {
    // single coarse requirement (+scope so decomposition is the only mech gap)
    writeFileSync(
      specPath,
      `thesis: "kids companion"\nscope_fence: ["offline only"]\nrequirements:\n  - id: R1\n    statement: "the whole companion"\n    acceptance: { tier: 1, gate: "node --test" }\n`,
    );
    const llm = new MockLlm([
      diag([{ dimension: "decomposition", severity: "blocking", problem: "R1 is coarse", suggestion: "split + remove original", needsUser: false }]),
      fill([
        { section: "requirements", op: "add", value: { statement: "voice loop", acceptance: { tier: 1, gate: "node --test voice" } }, drift: false },
        { section: "requirements", op: "add", value: { statement: "safety", acceptance: { tier: 4, artifact: "s.md" } }, drift: false },
        { section: "requirements", op: "remove", id: "R1", drift: false },
      ]),
      diag([]),
    ]);
    const r = await autofillSpec(specPath, llm, "m");
    expect(r.reachedReady).toBe(true);
    const final = parseSpec(readFileSync(specPath, "utf8"), specPath);
    expect(final.requirements.find((req) => req.id === "R1")).toBeUndefined(); // coarse original gone
    expect(final.requirements).toHaveLength(2);
  });

  it("converges over two rounds: split lands ungated, a second round gates the pieces", async () => {
    writeFileSync(
      specPath,
      `thesis: "kids companion"\nscope_fence: ["offline only"]\nrequirements:\n  - id: R1\n    statement: "the whole companion"\n    acceptance: { tier: 1, gate: "node --test" }\n`,
    );
    const llm = new MockLlm([
      diag([{ dimension: "decomposition", severity: "blocking", problem: "R1 coarse", suggestion: "split", needsUser: false }]),
      // round 1: pieces arrive WITHOUT gates (tier 0) — and remove the original
      fill([
        { section: "requirements", op: "add", value: { statement: "voice loop" }, drift: false },
        { section: "requirements", op: "add", value: { statement: "safety" }, drift: false },
        { section: "requirements", op: "remove", id: "R1", drift: false },
      ]),
      diag([]), // LLM happy, but mechanical anchoring (2 tier-0) keeps it not-ready
      // round 2: gate the two pieces (now R2, R3)
      fill([
        { section: "requirements", op: "modify", id: "R2", value: { acceptance: { tier: 1, gate: "node --test voice" } }, drift: false },
        { section: "requirements", op: "modify", id: "R3", value: { acceptance: { tier: 4, artifact: "s.md" } }, drift: false },
      ]),
      diag([]),
    ]);
    const r = await autofillSpec(specPath, llm, "m");
    expect(r.reachedReady).toBe(true);
    expect(r.rounds).toBe(2);
    const final = parseSpec(readFileSync(specPath, "utf8"), specPath);
    expect(final.requirements.every((req) => req.acceptance.tier >= 1)).toBe(true); // all gated
  });

  // A spec that is decomposed + gated + scoped but rests on an unverified
  // load-bearing claim, plus one blocking question — so it is not-ready until
  // the question resolves AND the claim is fact-checked.
  const withClaim = `thesis: "kids companion"
scope_fence: ["offline only"]
requirements:
  - id: R1
    statement: "voice loop"
    acceptance: { tier: 1, gate: "node --test voice" }
  - id: R2
    statement: "local NLP"
    acceptance: { tier: 1, gate: "node --test nlp" }
decisions:
  - id: D1
    statement: "run NLP locally on a Pi"
    rationale: "offline"
    claims: ["C1"]
claims:
  - id: C1
    statement: "a Raspberry Pi 4 can run local NLP within latency budget"
    status: "unverified"
    evidence: ""
open_questions:
  - { id: Q1, text: "wake word?", blocking: true }
`;
  const lens = (refuted: boolean, evidence: string): MockLlmResponse => ({ text: JSON.stringify({ refuted, evidence }) });

  it("fact-checks a load-bearing claim; survival clears the gap and reaches ready", async () => {
    writeFileSync(specPath, withClaim);
    const llm = new MockLlm([
      diag([]), // no soft gaps; mechanical: unverified claim + blocking Q
      fill([{ section: "open_questions", op: "resolve", id: "Q1", drift: false }]),
      lens(false, "arithmetic checks out"), // lens 1 survives
      lens(false, ""), // lens 2 survives
      diag([]),
    ]);
    const r = await autofillSpec(specPath, llm, "m", { maxRounds: 3 });
    expect(r.reachedReady).toBe(true);
    expect(r.refutedClaims).toHaveLength(0);
    expect(parseSpec(readFileSync(specPath, "utf8"), specPath).claims[0]!.status).toBe("verified");
  });

  it("surfaces a REFUTED feasibility claim (poker-bot catch) instead of building on it", async () => {
    writeFileSync(specPath, withClaim);
    const llm = new MockLlm([
      diag([]),
      fill([{ section: "open_questions", op: "resolve", id: "Q1", drift: false }]),
      lens(true, "Pi 4 ~5 GFLOPS; a usable local LLM needs far more — infeasible in latency budget"),
      diag([]),
    ]);
    const r = await autofillSpec(specPath, llm, "m", { maxRounds: 1 });
    expect(r.reachedReady).toBe(false);
    expect(r.refutedClaims).toHaveLength(1);
    expect(r.refutedClaims[0]!.evidence).toContain("infeasible");
    expect(parseSpec(readFileSync(specPath, "utf8"), specPath).claims[0]!.status).toBe("refuted");
  });

  it("bails out after maxRounds when each round gains nothing (no infinite loop)", async () => {
    // Always flags the same blocking gap; fill always adds a harmless minor edit
    // that never closes it — must stop on the stagnation/round cap, not spin.
    const llm = new MockLlm([
      ((call: { system: string }) =>
        call.system.includes('{"deltas"') // the fill prompt asks for deltas; the diagnostic for improvements
          ? fill([{ section: "scope_fence", op: "add", value: "another note", drift: false }])
          : diag([
              { dimension: "x", severity: "major", problem: "never closes", suggestion: "s", needsUser: false },
              { dimension: "y", severity: "major", problem: "also never closes", suggestion: "s", needsUser: false },
            ])),
    ]);
    const r = await autofillSpec(specPath, llm, "m", { maxRounds: 3 });
    expect(r.reachedReady).toBe(false);
    expect(r.rounds).toBeLessThanOrEqual(3);
  });
});
