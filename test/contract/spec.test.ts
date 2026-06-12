import { describe, it, expect } from "vitest";
import {
  parseSpec,
  unanchoredRequirements,
  unverifiedLoadBearing,
  refutedDecisions,
  blockingQuestions,
} from "../../src/contract/spec.js";

const valid = `
thesis: "cheap and reliable makes loops"
scope_fence: ["no TUI"]
requirements:
  - id: R1
    statement: "compile specs to plans"
    acceptance: { tier: 1, gate: "pnpm vitest run test/derive.test.ts" }
  - id: R2
    statement: "the chicken looks realistic"
    acceptance: { tier: 4, artifact: "renders/grid.png" }
decisions:
  - id: D1
    statement: "use CFR for the solver"
    rationale: "industry standard"
    claims: [C1]
claims:
  - id: C1
    statement: "full-game CFR is tractable at hobby scale"
    status: unverified
open_questions:
  - { id: Q1, text: "pricing model?", blocking: true }
`;

describe("spec schema (SPEC-v0.2 §5.1)", () => {
  it("parses a valid spec and applies defaults", () => {
    const s = parseSpec(valid);
    expect(s.requirements).toHaveLength(2);
    expect(s.claims[0]!.evidence).toBe("");
  });

  it("tier requirements: 1-3 need gate, 4 needs artifact, 0 carries nothing", () => {
    expect(() => parseSpec(valid.replace("{ tier: 1, gate: \"pnpm vitest run test/derive.test.ts\" }", "{ tier: 1 }"))).toThrow(/requires "gate"/);
    expect(() => parseSpec(valid.replace("{ tier: 4, artifact: \"renders/grid.png\" }", "{ tier: 4 }"))).toThrow(/requires "artifact"/);
    expect(() => parseSpec(valid.replace("{ tier: 4, artifact: \"renders/grid.png\" }", "{ tier: 0, gate: \"x\" }"))).toThrow(/must not carry/);
  });

  it("verified/refuted claims demand evidence; unknown claim refs rejected", () => {
    expect(() => parseSpec(valid.replace("status: unverified", "status: refuted"))).toThrow(/no evidence/);
    expect(parseSpec(valid.replace("status: unverified", 'status: refuted\n    evidence: "10^160 states x 1ns = heat death"')).claims[0]!.status).toBe("refuted");
    expect(() => parseSpec(valid.replace("claims: [C1]", "claims: [C9]"))).toThrow(/unknown claim/);
  });

  it("gate helpers expose exactly what ser spec check needs", () => {
    const s = parseSpec(
      valid
        .replace("{ tier: 4, artifact: \"renders/grid.png\" }", "{ tier: 0 }")
        .replace("status: unverified", 'status: refuted\n    evidence: "shown arithmetic"'),
    );
    expect(unanchoredRequirements(s)).toEqual(["R2"]);
    expect(refutedDecisions(s)).toEqual(["D1"]);
    expect(blockingQuestions(s)).toEqual(["Q1"]);
    expect(unverifiedLoadBearing(s)).toEqual([{ decision: "D1", claim: "C1" }]);
  });
});
