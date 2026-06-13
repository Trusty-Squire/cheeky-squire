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
  it("closes a model-flagged blocking gap and reaches build-ready", async () => {
    const llm = new MockLlm([
      diag([{ dimension: "gate-strength", severity: "blocking", problem: "R1 gate passes on a stub", suggestion: "assert varied inputs", needsUser: false }]),
      fill([{ section: "requirements", op: "modify", id: "R1", value: { id: "R1", statement: "voice loop", acceptance: { tier: 1, gate: "node --test loop --varied" } }, drift: false }]),
      diag([]), // gap closed
    ]);
    const r = await autofillSpec(specPath, llm, "m");
    expect(r.reachedReady).toBe(true);
    expect(r.applied.length).toBeGreaterThan(0);
    expect(r.rounds).toBe(1);
    // the edit actually landed on disk
    expect(readFileSync(specPath, "utf8")).toContain("--varied");
  });

  it("defaults a genuine fork and records it as a visible 'ser default:' decision", async () => {
    const llm = new MockLlm([
      diag([{ dimension: "hardware", severity: "blocking", problem: "no target runtime", suggestion: "pick a platform", needsUser: true }]),
      fill([{ section: "decisions", op: "add", value: { id: "D1", statement: "ser default: target an offline phone app", rationale: "most accessible for a parent", claims: [] }, drift: false }]),
      diag([]),
    ]);
    const r = await autofillSpec(specPath, llm, "m");
    expect(r.defaults.some((d) => /ser default: target an offline phone/.test(d))).toBe(true);
    expect(parseSpec(readFileSync(specPath, "utf8"), specPath).decisions[0]!.statement).toContain("ser default");
  });

  it("stops (not ready) when the model can produce no fix — surfaces to the user", async () => {
    const llm = new MockLlm([
      diag([{ dimension: "hardware", severity: "blocking", problem: "unresolvable", suggestion: "?", needsUser: true }]),
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

  it("bails out after maxRounds when each round gains nothing (no infinite loop)", async () => {
    // Always flags the same blocking gap; fill always adds a harmless minor edit
    // that never closes it — must stop on the stagnation/round cap, not spin.
    const llm = new MockLlm([
      ((call: { system: string }) =>
        call.system.includes('{"deltas"') // the fill prompt asks for deltas; the diagnostic for improvements
          ? fill([{ section: "scope_fence", op: "add", value: "another note", drift: false }])
          : diag([{ dimension: "x", severity: "blocking", problem: "never closes", suggestion: "s", needsUser: false }])),
    ]);
    const r = await autofillSpec(specPath, llm, "m", { maxRounds: 3 });
    expect(r.reachedReady).toBe(false);
    expect(r.rounds).toBeLessThanOrEqual(3);
  });
});
