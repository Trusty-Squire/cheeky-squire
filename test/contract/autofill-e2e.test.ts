import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autofillSpec } from "../../src/contract/autofill.js";
import { normalizeDeltas, applyDeltas } from "../../src/contract/spec-session.js";
import { scoreSpec } from "../../src/contract/spec-score.js";
import { parseSpec } from "../../src/contract/spec.js";
import { MockLlm, type MockLlmResponse } from "../../src/llm/mock.js";

/**
 * End-to-end: a blank spec driven to build-ready by autofill, against a mock
 * that mimics the REAL cheap model's sloppiness observed in dogfooding —
 * dotted requirement ids (R1.1), a missing-acceptance split, object-valued
 * fields. This is the regression net for "spec stays at 0/100": before the
 * id-repair fix the dotted-id split was dropped and the score never moved.
 */

const blank = `
thesis: "an ambient ai companion for my daughter"
requirements:
  - id: R1
    statement: "ambient AI companion"
    acceptance: { tier: 1, gate: "node --test" }
open_questions:
  - { id: Q1, text: "hardware?", blocking: true }
`;

const diag = (improvements: unknown[]): MockLlmResponse => ({ text: JSON.stringify({ improvements }) });
const fill = (deltas: unknown[]): MockLlmResponse => ({ text: JSON.stringify({ deltas }) });

let dir: string;
let specPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e2e-"));
  specPath = join(dir, "x.spec.yaml");
  writeFileSync(specPath, blank);
});

describe("normalizeDeltas repairs the model's sloppy ids (the stuck-at-0 root cause)", () => {
  it("dotted requirement ids (R1.1, R1.2) are reassigned to valid sequential ids and LAND", () => {
    const spec = parseSpec(blank);
    const fixed = normalizeDeltas(spec, [
      { section: "requirements", op: "add", value: { id: "R1.1", statement: "voice in/out", acceptance: { tier: 1, gate: "node --test voice" } }, drift: false },
      { section: "requirements", op: "add", value: { id: "R1.2", statement: "response generation", acceptance: { tier: 1, gate: "node --test reply" } }, drift: false },
      { section: "requirements", op: "add", value: { id: "R1.3", statement: "safety", acceptance: { tier: 4, artifact: "safety.md" } }, drift: false },
    ]);
    // every emitted id is now schema-valid and distinct
    const ids = fixed.map((d) => (d.value as { id: string }).id);
    expect(ids.every((i) => /^R\d+$/.test(i))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // and they actually apply — the dropped-decomposition bug is gone
    const next = applyDeltas(spec, fixed);
    expect(next.requirements.length).toBe(4); // R1 + 3 new
  });
});

describe("autofill drives a blank-ish spec to ready despite sloppy model output", () => {
  it("score moves off 0 and reaches build-ready", async () => {
    const llm = new MockLlm([
      // round 0 diagnosis: the coarse-requirement blocking gap + the blocking question
      diag([
        { dimension: "decomposition", severity: "blocking", problem: "R1 is one coarse requirement", suggestion: "split into capabilities, each gated", needsUser: false },
        { dimension: "decided", severity: "major", problem: "Q1 hardware is blocking", suggestion: "default a platform", needsUser: true },
      ]),
      // fill round 1: model splits R1 with DOTTED ids (sloppy) + resolves Q1 + a default decision
      fill([
        { section: "requirements", op: "add", value: { id: "R1.1", statement: "voice interaction loop", acceptance: { tier: 1, gate: "node --test voice --varied" } }, drift: false },
        { section: "requirements", op: "add", value: { id: "R1.2", statement: "child-safe responses", acceptance: { tier: 4, artifact: "transcripts/safety.md" } }, drift: false },
        { section: "requirements", op: "add", value: { id: "R1.3", statement: "offline persistence", acceptance: { tier: 1, gate: "node --test persist" } }, drift: false },
        { section: "open_questions", op: "resolve", id: "Q1", drift: false },
        { section: "scope_fence", op: "add", value: "offline only — no cloud", drift: false },
        { section: "decisions", op: "add", value: { id: "D1", statement: "ser default: target an offline phone app", rationale: "accessible", claims: [] }, drift: false },
      ]),
      // round 1 re-diagnosis: clean
      diag([]),
    ]);
    const before = await scoreSpec(parseSpec(readFileSync(specPath, "utf8"), specPath), { llm: new MockLlm([diag([{ dimension: "decomposition", severity: "blocking", problem: "coarse", suggestion: "split", needsUser: false }])]), model: "m" });
    expect(before.ready).toBe(false);

    const r = await autofillSpec(specPath, llm, "m");
    expect(r.reachedReady).toBe(true);
    expect(r.finalScore.score).toBeGreaterThan(before.score);
    expect(r.defaults.some((d) => /offline phone/.test(d))).toBe(true);

    // the spec on disk is genuinely decomposed with valid ids
    const final = parseSpec(readFileSync(specPath, "utf8"), specPath);
    expect(final.requirements.length).toBeGreaterThanOrEqual(3);
    expect(final.requirements.every((req) => /^R\d+$/.test(req.id))).toBe(true);
    expect(final.open_questions.filter((q) => q.blocking)).toHaveLength(0);
  });
});
