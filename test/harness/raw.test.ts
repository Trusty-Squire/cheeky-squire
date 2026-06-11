import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMission } from "../../src/harness/runner.js";
import { MockEngine, type ScriptResolver } from "../../src/engine/mock.js";
import { initRepo } from "../../src/harness/checkpoint.js";
import { parseMission, parseChains } from "../../src/contract/schema.js";
import { readTrace } from "../../src/harness/trace.js";

const chains = parseChains(`
chains:
  cheap-raw:
    executor: "qwen/qwen3-coder"
    fallback: "qwen/qwen3-coder"
    knight: "qwen/qwen3-coder"
    harness: "off"
prices:
  "qwen/qwen3-coder": { in: 0.2, out: 0.8 }
`);

const mission = `
goal: "make v = 1 and leave a marker"
budget_usd: 5
chain: cheap-raw
nodes:
  - id: fix
    brief: "edit src/target.ts so v = 1"
    blast_radius: ["src/**"]
    done_check: "grep -q 'v = 1' src/target.ts"
    budget_usd: 1
  - id: marker
    brief: "create src/marker.txt containing DONE"
    blast_radius: ["src/**"]
    done_check: "grep -q DONE src/marker.txt"
    budget_usd: 1
`;

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "squire-raw-"));
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "target.ts"), "export const v = 0;\n");
  await initRepo(repo);
});

function run(resolveScript: ScriptResolver) {
  return runMission({
    mission: parseMission(mission),
    chains,
    engine: new MockEngine({ resolveScript }),
    workdir: repo,
    missionId: "raw-test",
    tracePath: join(repo, ".squire", "trace.jsonl"),
    harnessMode: "off",
  });
}

describe("raw mode (harness off)", () => {
  it("runs ONE goal-only attempt and scores every node's done_check", async () => {
    const calls: { nodeId: string }[] = [];
    const result = await run((nodeId) => {
      calls.push({ nodeId });
      return {
        steps: [
          { tool: "write", args: { path: "src/target.ts", content: "export const v = 1;\n" } },
          { tool: "write", args: { path: "src/marker.txt", content: "DONE\n" } },
          { done: "did both" },
        ],
      };
    });
    // exactly one engine attempt, addressed to the synthetic (raw) node
    expect(calls).toEqual([{ nodeId: "(raw)" }]);
    expect(result.completed).toBe(true);
    expect(result.committedNodeIds.sort()).toEqual(["fix", "marker"]);
    expect(readFileSync(join(repo, "src", "target.ts"), "utf8")).toContain("v = 1");
    // trace carries node_pass scoring events for the real nodes (uniform shape)
    const kinds = readTrace(result.tracePath).map((e) => e.kind);
    expect(kinds.filter((k) => k === "node_pass")).toHaveLength(2);
    expect(kinds).toContain("gate");
  });

  it("scores partial credit when the raw attempt only does some of the work", async () => {
    const result = await run(() => ({
      steps: [
        { tool: "write", args: { path: "src/target.ts", content: "export const v = 1;\n" } },
        { done: "fixed v but forgot the marker" },
      ],
    }));
    expect(result.completed).toBe(false);
    expect(result.committedNodeIds).toEqual(["fix"]);
    const events = readTrace(result.tracePath);
    expect(events.some((e) => e.kind === "node_fail" && e.nodeId === "marker")).toBe(true);
  });

  it("does not enforce blast radius or escalate in raw mode", async () => {
    const result = await run(() => ({
      // writes outside any node's blast_radius — allowed in raw mode
      steps: [
        { tool: "write", args: { path: "src/target.ts", content: "export const v = 1;\n" } },
        { tool: "write", args: { path: "elsewhere/notes.md", content: "free write\n" } },
        { tool: "write", args: { path: "src/marker.txt", content: "DONE\n" } },
        { done: "done" },
      ],
    }));
    expect(result.completed).toBe(true);
    const events = readTrace(result.tracePath);
    expect(events.some((e) => e.kind === "blast_denied")).toBe(false);
    expect(events.some((e) => e.kind === "escalate")).toBe(false);
    // only one node_start (the raw attempt), not one per node
    expect(events.filter((e) => e.kind === "node_start")).toHaveLength(1);
  });
});
