import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Usage,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { PiEngine, outputCapFor } from "../../src/engine/pi.js";
import type { AttemptRequest, EngineEvent } from "../../src/engine/types.js";

/** Build a full Usage object from input/output token counts. */
function usage(input: number, output: number): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

type TurnSpec =
  | { tools: { id: string; name: string; arguments: Record<string, unknown> }[]; in: number; out: number }
  | { text: string; in: number; out: number };

/** A deterministic, network-free streamFn that replays scripted assistant turns. */
function scriptedStreamFn(turns: TurnSpec[]): StreamFn {
  let i = 0;
  return ((..._args: unknown[]) => {
    const spec = turns[Math.min(i, turns.length - 1)]!;
    i += 1;
    const isTools = "tools" in spec;
    const content: AssistantMessage["content"] = isTools
      ? spec.tools.map((t) => ({ type: "toolCall", id: t.id, name: t.name, arguments: t.arguments }))
      : [{ type: "text", text: spec.text }];
    const msg: AssistantMessage = {
      role: "assistant",
      content,
      api: "openai-completions",
      provider: "openrouter",
      model: "test/model",
      usage: usage(spec.in, spec.out),
      stopReason: isTools ? "toolUse" : "stop",
      timestamp: 0,
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: msg });
    stream.push({ type: "done", reason: isTools ? "toolUse" : "stop", message: msg });
    return stream;
  }) as unknown as StreamFn;
}

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "squire-pi-"));
  mkdirSync(join(cwd, "src"), { recursive: true });
});

function req(overrides: Partial<AttemptRequest> = {}): AttemptRequest {
  return {
    systemPrompt: "You are a squire.",
    brief: "do the thing",
    files: [],
    cwd,
    model: { slug: "qwen/qwen3-coder", apiKey: "test-key" },
    tools: { blastRadius: ["src/**"] },
    maxTokens: 4000,
    nodeId: "n1",
    rung: 1,
    ...overrides,
  };
}

async function collect(engine: PiEngine, request: AttemptRequest): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const ev of engine.runAttempt(request)) events.push(ev);
  return events;
}

describe("PiEngine (network-free via injected streamFn)", () => {
  it("executes a write within blast radius and reports usage + done", async () => {
    const engine = new PiEngine({
      streamFn: scriptedStreamFn([
        {
          tools: [{ id: "t1", name: "write", arguments: { path: "src/a.ts", content: "export const a = 1;" } }],
          in: 500,
          out: 100,
        },
        { text: "Wrote src/a.ts.", in: 50, out: 20 },
      ]),
    });
    const events = await collect(engine, req());
    expect(readFileSync(join(cwd, "src", "a.ts"), "utf8")).toBe("export const a = 1;");
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("usage");
    expect(events.at(-1)).toMatchObject({ kind: "done" });
    const totalIn = events
      .filter((e): e is Extract<EngineEvent, { kind: "usage" }> => e.kind === "usage")
      .reduce((s, e) => s + e.inTokens, 0);
    expect(totalIn).toBe(550);
  });

  it("DENIES an out-of-radius write via the harness, emitting blast_denied", async () => {
    const engine = new PiEngine({
      streamFn: scriptedStreamFn([
        {
          tools: [{ id: "t1", name: "write", arguments: { path: "secrets/key.ts", content: "leak" } }],
          in: 100,
          out: 20,
        },
        { text: "tried", in: 10, out: 5 },
      ]),
    });
    const events = await collect(engine, req());
    expect(existsSync(join(cwd, "secrets", "key.ts"))).toBe(false);
    const denied = events.find((e) => e.kind === "blast_denied");
    expect(denied).toBeDefined();
    expect(denied && "path" in denied && denied.path).toMatch(/secrets\/key\.ts/);
  });

  it("aborts the attempt after 3 blast-radius violations", async () => {
    const engine = new PiEngine({
      streamFn: scriptedStreamFn([
        {
          tools: [
            { id: "t1", name: "write", arguments: { path: "a/1.ts", content: "x" } },
            { id: "t2", name: "write", arguments: { path: "b/2.ts", content: "x" } },
            { id: "t3", name: "write", arguments: { path: "c/3.ts", content: "x" } },
          ],
          in: 100,
          out: 20,
        },
        { text: "should not reach happily", in: 10, out: 5 },
      ]),
    });
    const events = await collect(engine, req());
    const denials = events.filter((e) => e.kind === "blast_denied");
    expect(denials.length).toBe(3);
    expect(events.some((e) => e.kind === "error")).toBe(true);
  });

  it("bounds output max_tokens on every call (avoids provider over-pre-authorization)", async () => {
    const seen: (number | undefined)[] = [];
    const recordingStream: StreamFn = ((model: unknown, context: unknown, options: { maxTokens?: number }) => {
      seen.push(options?.maxTokens);
      const msg = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "done" }],
        api: "openai-completions",
        provider: "openrouter",
        model: "test/model",
        usage: usage(10, 5),
        stopReason: "stop" as const,
        timestamp: 0,
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: msg });
      stream.push({ type: "done", reason: "stop", message: msg });
      return stream;
    }) as unknown as StreamFn;

    const engine = new PiEngine({ streamFn: recordingStream });
    await collect(engine, req({ maxTokens: 40_000 }));
    expect(seen.length).toBeGreaterThan(0);
    // 40k requested context budget must be capped to the 8192 output ceiling.
    expect(seen.every((m) => m === 8192)).toBe(true);
    expect(outputCapFor(40_000)).toBe(8192);
    expect(outputCapFor(100)).toBe(100);
  });

  it("runs bash and reads files", async () => {
    writeFileSync(join(cwd, "src", "x.ts"), "hello world");
    const engine = new PiEngine({
      streamFn: scriptedStreamFn([
        { tools: [{ id: "r1", name: "read", arguments: { path: "src/x.ts" } }], in: 30, out: 10 },
        { tools: [{ id: "b1", name: "bash", arguments: { command: "echo ran" } }], in: 30, out: 10 },
        { text: "done", in: 10, out: 5 },
      ]),
    });
    const events = await collect(engine, req());
    const results = events.filter(
      (e): e is Extract<EngineEvent, { kind: "tool_result" }> => e.kind === "tool_result",
    );
    expect(results.some((r) => r.output.includes("hello world"))).toBe(true);
    expect(results.some((r) => r.output.includes("ran"))).toBe(true);
  });
});
