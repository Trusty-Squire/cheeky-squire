import { describe, it, expect } from "vitest";
import { applyChoice, resolveBrief, ideaToSpec, type BriefIO } from "../../src/contract/brief.js";
import { makeStyler } from "../../src/style.js";
import type { Decision, IdeaResult } from "../../src/contract/ingest.js";

const st = makeStyler(false); // plain for assertions

const dec = (over: Partial<Decision>): Decision => ({
  question: "q",
  why: "",
  recommendation: "rec",
  alternatives: ["altA", "altB"],
  bucket: 1,
  canGuess: false,
  forksHard: true,
  costlyToUndo: true,
  ...over,
});

describe("applyChoice (pure)", () => {
  const d = dec({});
  it("empty = accept recommendation", () => {
    expect(applyChoice(d, "")).toMatchObject({ answer: "rec", mode: "accepted" });
    expect(applyChoice(d, "   ")).toMatchObject({ mode: "accepted" });
  });
  it("a/b pick alternatives by letter", () => {
    expect(applyChoice(d, "a")).toMatchObject({ answer: "altA", mode: "picked" });
    expect(applyChoice(d, "B")).toMatchObject({ answer: "altB", mode: "picked" });
  });
  it("s = skip (defaults to recommendation, flagged ser's call)", () => {
    expect(applyChoice(d, "s")).toMatchObject({ answer: "rec", mode: "skipped" });
  });
  it("anything else = custom typed answer (with optional 't ' prefix)", () => {
    expect(applyChoice(d, "Raspberry Pi 4")).toMatchObject({ answer: "Raspberry Pi 4", mode: "custom" });
    expect(applyChoice(d, "t phone")).toMatchObject({ answer: "phone", mode: "custom" });
  });
  it("an out-of-range letter is treated as a typed answer, not a crash", () => {
    expect(applyChoice(d, "z")).toMatchObject({ answer: "z", mode: "custom" });
  });
});

describe("resolveBrief (scripted IO)", () => {
  function scriptedIO(answers: string[]): BriefIO & { lines: string[] } {
    let i = 0;
    const lines: string[] = [];
    return { lines, print: (l) => lines.push(l), ask: async () => answers[i++] ?? "" };
  }

  it("resolves asks in order and auto-accepts + shows defaults", async () => {
    const decisions: Decision[] = [
      dec({ question: "hardware?", recommendation: "Pi 4", alternatives: ["phone"], bucket: 1 }),
      dec({ question: "age?", recommendation: "6-8", alternatives: ["3-5", "9-12"], bucket: 1 }),
      dec({ question: "db?", recommendation: "Postgres", bucket: 2, canGuess: true }),
    ];
    const io = scriptedIO(["", "b"]); // accept hardware, pick alt 'b' (9-12) for age
    const r = await resolveBrief(decisions, io, st);
    expect(r.map((x) => `${x.mode}:${x.answer}`)).toEqual(["accepted:Pi 4", "picked:9-12", "accepted:Postgres"]);
    // the default is surfaced so a mis-bucket is catchable
    expect(io.lines.join("\n")).toContain("db? → ");
    expect(io.lines.join("\n")).toContain("Postgres");
  });

  it("no asks → proceeds on best judgment, still records defaults", async () => {
    const decisions: Decision[] = [dec({ question: "x?", recommendation: "y", bucket: 2 })];
    const io = scriptedIO([]);
    const r = await resolveBrief(decisions, io, st);
    expect(r).toHaveLength(1);
    expect(io.lines.join("\n")).toContain("no decisions need you");
  });
});

describe("ideaToSpec", () => {
  const idea: IdeaResult = {
    stories: ["she asks a question", "it greets her"],
    components: [
      { statement: "voice loop", story: "asks", gate: { tier: 1, gate: "node --test voice" } },
      { statement: "safety", story: "greets", gate: { tier: 4, artifact: "safety.md" } },
      { statement: "vague thing", story: "x", gate: { tier: 1 } }, // malformed gate (tier 1 no cmd) → tier 0
    ],
    decisions: [],
  };

  it("compiles stories + components + resolutions into a valid spec", () => {
    const resolutions = [
      { decision: dec({ question: "hardware?" }), answer: "Pi 4", mode: "custom" as const },
      { decision: dec({ question: "db?" }), answer: "Postgres", mode: "accepted" as const },
    ];
    const spec = ideaToSpec("a companion", idea, resolutions);
    expect(spec.thesis).toBe("a companion");
    expect(spec.stories).toHaveLength(2);
    expect(spec.requirements.map((r) => r.id)).toEqual(["R1", "R2", "R3"]);
    expect(spec.requirements[0]!.acceptance).toMatchObject({ tier: 1, gate: "node --test voice" });
    expect(spec.requirements[1]!.acceptance).toMatchObject({ tier: 4, artifact: "safety.md" });
    expect(spec.requirements[2]!.acceptance.tier).toBe(0); // malformed gate coerced
    expect(spec.decisions[0]!.statement).toContain("hardware? → Pi 4");
    expect(spec.decisions[0]!.rationale).toContain("your call");
    expect(spec.decisions[1]!.rationale).toContain("ser accepted");
  });

  it("never produces a zero-requirement spec (falls back to the prompt)", () => {
    const spec = ideaToSpec("a thing", { stories: [], components: [], decisions: [] }, []);
    expect(spec.requirements).toHaveLength(1);
    expect(spec.requirements[0]!.statement).toBe("a thing");
  });
});
