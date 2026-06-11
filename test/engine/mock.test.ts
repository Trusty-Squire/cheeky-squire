import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockEngine } from "../../src/engine/mock.js";
import type { AttemptRequest, EngineEvent } from "../../src/engine/types.js";

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "squire-mock-"));
});

function req(overrides: Partial<AttemptRequest> = {}): AttemptRequest {
  return {
    systemPrompt: "sys",
    brief: "brief",
    files: [],
    cwd,
    model: { slug: "mock/model" },
    tools: { blastRadius: ["src/**"] },
    maxTokens: 1000,
    nodeId: "n1",
    rung: 1,
    ...overrides,
  };
}

async function collect(engine: MockEngine, request: AttemptRequest): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const ev of engine.runAttempt(request)) events.push(ev);
  return events;
}

describe("MockEngine", () => {
  it("replays a script and executes writes for real", async () => {
    const engine = new MockEngine({
      resolveScript: () => ({
        steps: [
          { text: "writing file" },
          { tool: "write", args: { path: "src/a.ts", content: "export const a = 1;" } },
          { usage: { in: 100, out: 50 } },
          { done: "wrote src/a.ts" },
        ],
      }),
    });
    const events = await collect(engine, req());
    expect(readFileSync(join(cwd, "src", "a.ts"), "utf8")).toBe("export const a = 1;");
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("usage");
    expect(events.at(-1)).toEqual({ kind: "done", finalMessage: "wrote src/a.ts" });
  });

  it("emits blast_denied for an out-of-radius write and does not write", async () => {
    const engine = new MockEngine({
      resolveScript: () => ({
        steps: [
          { tool: "write", args: { path: "evil/x.ts", content: "nope" } },
          { done: "tried" },
        ],
      }),
    });
    const events = await collect(engine, req());
    const denied = events.find((e) => e.kind === "blast_denied");
    expect(denied).toBeDefined();
    const result = events.find((e) => e.kind === "tool_result");
    expect(result && "ok" in result && result.ok).toBe(false);
  });

  it("synthesizes a done event when the script omits one", async () => {
    const engine = new MockEngine({
      resolveScript: () => ({ steps: [{ text: "all done implicitly" }] }),
    });
    const events = await collect(engine, req());
    expect(events.at(-1)).toEqual({ kind: "done", finalMessage: "all done implicitly" });
  });

  it("selects a rung-specific script when the resolver returns one", async () => {
    const engine = new MockEngine({
      resolveScript: (_id, rung) => ({ steps: [{ done: `rung ${rung}` }] }),
    });
    const events = await collect(engine, req({ rung: 3 }));
    expect(events.at(-1)).toEqual({ kind: "done", finalMessage: "rung 3" });
  });
});
