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
