import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { SpecSession, applyDeltas, checkSpec, type DeltaBatch } from "../../src/contract/spec-session.js";
import { parseSpec } from "../../src/contract/spec.js";
import { MockLlm } from "../../src/llm/mock.js";
import { SquireError } from "../../src/errors.js";

const baseSpec = `
thesis: "cheap and reliable makes loops"
requirements:
  - id: R1
    statement: "compile specs"
    acceptance: { tier: 1, gate: "pnpm test" }
open_questions:
  - { id: Q1, text: "pricing?", blocking: true }
`;

let dir: string;
let specPath: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "spec-sess-"));
  specPath = join(dir, "product.spec.yaml");
  writeFileSync(specPath, baseSpec);
  await execa("git", ["init", "-q"], { cwd: dir });
  await execa("git", ["config", "user.email", "t@t.t"], { cwd: dir });
  await execa("git", ["config", "user.name", "t"], { cwd: dir });
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa("git", ["commit", "-qm", "init"], { cwd: dir });
});

const batchAddDecision: DeltaBatch = {
  deltas: [
    {
      section: "claims",
      op: "add",
      value: { id: "C1", statement: "meter-watchers will adopt", status: "unverified", evidence: "" },
      drift: false,
    },
    {
      section: "decisions",
      op: "add",
      value: { id: "D1", statement: "lead with receipts", rationale: "H1/H2 research", claims: ["C1"] },
      drift: false,
    },
    { section: "open_questions", op: "resolve", id: "Q1", drift: false },
  ],
  question: "should the hosted tier ship in v0.3?",
  reply: "logged. receipts-first it is.",
  note: "mapped your pricing comment to D1 + resolved Q1",
};

describe("applyDeltas (pure, validated)", () => {
  it("applies adds/resolves and re-validates", () => {
    const next = applyDeltas(parseSpec(baseSpec), batchAddDecision.deltas);
    expect(next.decisions[0]!.id).toBe("D1");
    expect(next.open_questions).toHaveLength(0);
  });

  it("refuses deltas that would invalidate the spec (unknown claim ref)", () => {
    expect(() =>
      applyDeltas(parseSpec(baseSpec), [
        { section: "decisions", op: "add", value: { id: "D1", statement: "x", rationale: "y", claims: ["C9"] }, drift: false },
      ]),
    ).toThrow(SquireError);
  });

  it("modify targets by id; missing targets throw", () => {
    expect(() =>
      applyDeltas(parseSpec(baseSpec), [{ section: "requirements", op: "modify", id: "R9", value: {}, drift: false }]),
    ).toThrow(/not found/);
  });
});

describe("SpecSession — the artifact is the state", () => {
  it("turn proposes deltas; accept applies, saves, git-commits; resume = new session reads same state", async () => {
    const llm = new MockLlm([{ text: JSON.stringify(batchAddDecision) }]);
    const s1 = new SpecSession({ path: specPath, llm, executorModel: "cheap/x", knightModel: "frontier/y" });
    const batch = await s1.turn("enterprises buy receipts, not discounts — log that and kill the pricing question");
    expect(batch.deltas).toHaveLength(3);
    await s1.accept(batch);

    // process "restart": a brand-new session sees the accepted state from disk
    const s2 = new SpecSession({ path: specPath, llm: new MockLlm([]), executorModel: "cheap/x", knightModel: "frontier/y" });
    const resumed = s2.load();
    expect(resumed.decisions[0]!.id).toBe("D1");
    expect(resumed.open_questions).toHaveLength(0);
    // and the acceptance is a git commit (checkpointed thinking)
    const log = await execa("git", ["log", "--oneline"], { cwd: dir });
    expect(log.stdout).toContain("spec(product.spec.yaml): 3 delta(s)");
  });

  it("bounded context: each turn sends current spec + last message only (no transcript)", async () => {
    const llm = new MockLlm([{ text: JSON.stringify(batchAddDecision) }, { text: JSON.stringify({ deltas: [], question: "", note: "" }) }]);
    const s = new SpecSession({ path: specPath, llm, executorModel: "cheap/x", knightModel: "frontier/y" });
    await s.accept(await s.turn("first message"));
    await s.turn("second message");
    // second call's user content contains the SPEC and the SECOND message, not the first
    expect(llm.calls[1]!.user).toContain("second message");
    expect(llm.calls[1]!.user).not.toContain("first message");
  });

  it("two consecutive rejections escalate generative turns to the knight", async () => {
    const llm = new MockLlm([
      { text: JSON.stringify({ deltas: [], question: "", note: "" }) },
      { text: JSON.stringify({ deltas: [], question: "", note: "" }) },
      { text: JSON.stringify({ deltas: [], question: "", note: "" }) },
    ]);
    const s = new SpecSession({ path: specPath, llm, executorModel: "cheap/x", knightModel: "frontier/y" });
    await s.turn("a");
    s.reject();
    await s.turn("b");
    s.reject();
    expect(s.currentModel()).toBe("frontier/y");
    await s.turn("c");
    expect(llm.calls.map((c) => c.model)).toEqual(["cheap/x", "cheap/x", "frontier/y"]);
  });
});

describe("checkSpec — the five gates, mechanical subset", () => {
  it("fails on blocking questions + unverified load-bearing claims, passes when resolved", () => {
    const withDecision = applyDeltas(parseSpec(baseSpec), batchAddDecision.deltas);
    const r1 = checkSpec(withDecision);
    expect(r1.ok).toBe(false);
    expect(r1.lines.join("\n")).toContain("rests on C1");

    const verified = applyDeltas(withDecision, [
      { section: "claims", op: "modify", id: "C1", value: { status: "verified", evidence: "https://example.com/research" }, drift: false },
    ]);
    const r2 = checkSpec(verified);
    expect(r2.ok).toBe(true);
    expect(r2.lines.join("\n")).toContain("READY to compile");
  });
});

describe("bookkeeping never kills the conversation", () => {
  it("salvageBatch keeps reply/question and individually-valid deltas", async () => {
    const { salvageBatch } = await import("../../src/contract/spec-session.js");
    const b = salvageBatch({
      reply: "build a voice loop on a Pi",
      question: "voice only?",
      deltas: [
        { section: "claims", op: "add", value: { id: "C1", statement: "x" } }, // valid
        { section: "nonsense", op: "add" }, // invalid section — dropped
      ],
    });
    expect(b.reply).toContain("voice loop");
    expect(b.deltas).toHaveLength(1);
  });

  it("applyDeltasLenient applies the good edits and reports the bad", async () => {
    const { applyDeltasLenient } = await import("../../src/contract/spec-session.js");
    const spec = parseSpec(baseSpec);
    const r = applyDeltasLenient(spec, [
      { section: "claims", op: "add", value: { id: "C1", statement: "ok", status: "unverified", evidence: "" }, drift: false },
      { section: "decisions", op: "add", value: { id: "D1", statement: "bad", rationale: "r", claims: ["C99"] }, drift: false },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
    expect(r.spec.claims[0]!.id).toBe("C1");
    expect(r.dropped[0]!.reason).toContain("C99");
  });
});

describe("self-knowledge composition (no architectural drift between prompts)", () => {
  it("spec-talk and derive prompts share the canonical gate ladder and identity", async () => {
    const { DELTA_MAPPER_PROMPT } = await import("../../src/contract/spec-session.js");
    const { CASTELLAN_IDENTITY, GATE_LADDER_DOC, gatePatternDoc } = await import("../../src/contract/self-knowledge.js");
    const { GATE_PATTERNS } = await import("../../src/contract/gate-patterns.js");
    expect(DELTA_MAPPER_PROMPT).toContain(CASTELLAN_IDENTITY);
    expect(DELTA_MAPPER_PROMPT).toContain("tier 4 in a costume");
    expect(CASTELLAN_IDENTITY).toContain("never grades its own homework");
    expect(GATE_LADDER_DOC).toContain("tier 4 (human)");
    // dogfood 2026-06-11: "build it" made spec-talk roleplay a completed build
    // ("Demo ready") and try to resolve requirements to match its own fiction.
    expect(DELTA_MAPPER_PROMPT.replace(/\s+/g, " ")).toContain("NEVER claim work was performed");
    expect(CASTELLAN_IDENTITY).toContain("claiming work that was not performed is the exact failure Castellan exists to kill");
    const { SPEC_ITEM_SHAPES } = await import("../../src/contract/self-knowledge.js");
    expect(SPEC_ITEM_SHAPES).toContain("resolve ONLY on");
    // pattern doc is GENERATED from the library — every pattern id present, forever
    const doc = gatePatternDoc();
    for (const p of GATE_PATTERNS) expect(doc).toContain(p.id);
  });
});
