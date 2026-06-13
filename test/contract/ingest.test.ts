import { describe, it, expect } from "vitest";
import { bucketOf, extractIdea, renderIdea } from "../../src/contract/ingest.js";
import { MockLlm } from "../../src/llm/mock.js";

describe("bucketOf (the 3-test, code-owned)", () => {
  it("not forks-hard → bucket 3 (silent trivia) regardless of the rest", () => {
    expect(bucketOf({ forksHard: false, canGuess: false, costlyToUndo: true })).toBe(3);
    expect(bucketOf({ forksHard: false, canGuess: true, costlyToUndo: false })).toBe(3);
  });
  it("forks-hard but guessable OR cheap-to-undo → bucket 2 (default + flag)", () => {
    expect(bucketOf({ forksHard: true, canGuess: true, costlyToUndo: true })).toBe(2); // guessable
    expect(bucketOf({ forksHard: true, canGuess: false, costlyToUndo: false })).toBe(2); // cheap to flip
  });
  it("forks-hard AND can't-guess AND costly-to-undo → bucket 1 (ASK NOW)", () => {
    expect(bucketOf({ forksHard: true, canGuess: false, costlyToUndo: true })).toBe(1);
  });
  it("the only path to ASK is the full conjunction (no other combo asks)", () => {
    let asks = 0;
    for (const forksHard of [true, false])
      for (const canGuess of [true, false])
        for (const costlyToUndo of [true, false])
          if (bucketOf({ forksHard, canGuess, costlyToUndo }) === 1) asks++;
    expect(asks).toBe(1); // exactly one of the 8 combinations asks
  });
});

describe("extractIdea (buckets derived in code from the model's facts)", () => {
  const sample = {
    stories: ["she asks a question and gets a kid-safe answer", "it greets her when she walks in"],
    components: [
      { statement: "voice question answering", story: "asks a question", gate: { tier: 1, gate: "node --test voice" } },
      { statement: "presence detection", story: "greets her", gate: { tier: 1, gate: "node --test presence" } },
    ],
    decisions: [
      // ASK: hardware — can't guess, forks hard, costly
      { question: "target hardware?", why: "changes every gate", recommendation: "Pi 4", alternatives: ["phone"], canGuess: false, forksHard: true, costlyToUndo: true },
      // DEFAULT: latency — guessable
      { question: "latency budget?", why: "perf gate", recommendation: "2s", alternatives: ["1s"], canGuess: true, forksHard: true, costlyToUndo: false },
      // SILENT: greeting wording — cosmetic
      { question: "greeting wording?", why: "copy", recommendation: "Hi!", alternatives: [], canGuess: true, forksHard: false, costlyToUndo: false },
    ],
  };

  it("classifies a realistic mix into ask / default / silent", async () => {
    const llm = new MockLlm([{ text: JSON.stringify(sample) }]);
    const r = await extractIdea("an ambient ai companion for my daughter", llm, "m");
    expect(r.stories).toHaveLength(2);
    expect(r.components).toHaveLength(2);
    const byBucket = (b: number) => r.decisions.filter((d) => d.bucket === b).map((d) => d.question);
    expect(byBucket(1)).toEqual(["target hardware?"]);
    expect(byBucket(2)).toEqual(["latency budget?"]);
    expect(byBucket(3)).toEqual(["greeting wording?"]);
  });

  it("renderIdea summarizes the counts and surfaces the ASK decisions", async () => {
    const llm = new MockLlm([{ text: JSON.stringify(sample) }]);
    const lines = renderIdea(await extractIdea("x", llm, "m")).join("\n");
    expect(lines).toContain("1 ask, 1 default, 1 silent");
    expect(lines).toContain("[ASK]  target hardware?");
    expect(lines).toContain("[auto] latency budget?");
  });

  it("throws a clear error on non-JSON model output", async () => {
    const llm = new MockLlm([{ text: "sorry, here is a paragraph instead" }]);
    await expect(extractIdea("x", llm, "m")).rejects.toThrow(/idea phase/);
  });
});
