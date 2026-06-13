import { describe, it, expect } from "vitest";
import {
  scoreSpec,
  scoreFromImprovements,
  mechanicalImprovements,
  renderScoreLine,
  READY_THRESHOLD,
  type Improvement,
} from "../../src/contract/spec-score.js";
import { parseSpec } from "../../src/contract/spec.js";
import { MockLlm } from "../../src/llm/mock.js";

const thin = `
thesis: "an ambient ai companion for my daughter"
requirements:
  - id: R1
    statement: "ambient AI companion"
    acceptance: { tier: 1, gate: "node --test" }
open_questions:
  - { id: Q1, text: "hardware?", blocking: true }
`;

const mature = `
thesis: "an ambient ai companion for my daughter"
scope_fence:
  - "no cloud — fully offline"
  - "no open-ended web access"
requirements:
  - id: R1
    statement: "voice interaction loop"
    acceptance: { tier: 1, gate: "node --test loop.test.js" }
  - id: R2
    statement: "child-safe responses"
    acceptance: { tier: 4, artifact: "transcripts/safety-review.md" }
  - id: R3
    statement: "persistence across sessions"
    acceptance: { tier: 1, gate: "node --test persist.test.js" }
`;

describe("mechanicalImprovements (objective floor, no LLM)", () => {
  it("flags tier-0 as blocking, single requirement as coarse, blocking question, empty scope", () => {
    const spec = parseSpec(`
thesis: "x"
requirements:
  - id: R1
    statement: "everything"
    acceptance: { tier: 0 }
open_questions:
  - { id: Q1, text: "?", blocking: true }
`);
    const imps = mechanicalImprovements(spec);
    const dims = imps.map((i) => i.dimension);
    expect(dims).toContain("anchoring"); // tier 0
    expect(dims).toContain("decomposition"); // 1 requirement
    expect(dims).toContain("decided"); // blocking Q
    expect(dims).toContain("scope"); // empty fence
    expect(imps.find((i) => i.dimension === "anchoring")!.severity).toBe("blocking");
  });
});

describe("scoreFromImprovements (code owns the number)", () => {
  it("a blocking improvement caps readiness regardless of score arithmetic", () => {
    const imps: Improvement[] = [
      { dimension: "anchoring", severity: "blocking", problem: "p", suggestion: "s", needsUser: false },
    ];
    const s = scoreFromImprovements(imps);
    expect(s.score).toBe(60); // 100 - 40
    expect(s.ready).toBe(false);
  });

  it("a clean spec scores 100 and is ready", () => {
    expect(scoreFromImprovements([])).toEqual({ score: 100, ready: true, improvements: [] });
  });

  it("minor-only gaps stay above threshold and ready", () => {
    const s = scoreFromImprovements([
      { dimension: "scope", severity: "minor", problem: "p", suggestion: "s", needsUser: false },
    ]);
    expect(s.score).toBe(95);
    expect(s.ready).toBe(true);
  });
});

describe("scoreSpec (mechanical-only, offline)", () => {
  it("a thin one-requirement spec is NOT ready (coarse + blocking question)", async () => {
    const s = await scoreSpec(parseSpec(thin));
    expect(s.ready).toBe(false);
    expect(s.score).toBeLessThan(READY_THRESHOLD);
    expect(s.improvements.some((i) => i.dimension === "decomposition")).toBe(true);
  });

  it("a decomposed, gated, scoped spec clears the bar mechanically", async () => {
    const s = await scoreSpec(parseSpec(mature));
    expect(s.ready).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(READY_THRESHOLD);
  });
});

describe("scoreSpec (with the LLM diagnostician)", () => {
  it("merges model-proposed gaps and never lets them inflate the score", async () => {
    const llm = new MockLlm([
      {
        text: JSON.stringify({
          improvements: [
            { dimension: "gate-strength", severity: "major", problem: "R1 gate passes on a stub", suggestion: "assert varied inputs", needsUser: false },
            { dimension: "hardware", severity: "blocking", problem: "no target runtime", suggestion: "pick phone or device", needsUser: true },
          ],
        }),
      },
    ]);
    const s = await scoreSpec(parseSpec(mature), { llm, model: "m" });
    expect(s.improvements.some((i) => i.dimension === "gate-strength")).toBe(true);
    expect(s.improvements.some((i) => i.needsUser)).toBe(true);
    expect(s.ready).toBe(false); // the blocking model gap pulls it back below ready
  });

  it("malformed diagnostician output degrades to the mechanical floor", async () => {
    const llm = new MockLlm([{ text: "not json at all" }]);
    const s = await scoreSpec(parseSpec(mature), { llm, model: "m" });
    expect(s.ready).toBe(true); // mechanical floor still stands
  });
});

describe("renderScoreLine", () => {
  it("ready specs show the bar only", () => {
    expect(renderScoreLine({ score: 92, ready: true, improvements: [] })).toBe("spec score: 92/100 — READY to build");
  });

  it("surfaces the worst gap, labelled decision vs suggestion", () => {
    const line = renderScoreLine({
      score: 55,
      ready: false,
      improvements: [
        { dimension: "hardware", severity: "blocking", problem: "no runtime", suggestion: "pick one", needsUser: true },
      ],
    });
    expect(line).toContain("55/100");
    expect(line).toContain("next decision");
    expect(line).toContain("no runtime");
  });
});
