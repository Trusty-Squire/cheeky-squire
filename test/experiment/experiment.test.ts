import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverTasks } from "../../src/experiment/tasks.js";
import { validateTask, runTask } from "../../src/experiment/run.js";
import { parseMission, parseChains } from "../../src/contract/schema.js";
import { runMission } from "../../src/harness/runner.js";
import { initRepo } from "../../src/harness/checkpoint.js";
import { MockEngine } from "../../src/engine/mock.js";

const ROOT = resolve(__dirname, "..", "..");
const TASKS_ROOT = join(ROOT, "tasks");

const chains = parseChains(readFileSync(join(ROOT, "chains.yaml"), "utf8"));

describe("benchmark task suite", () => {
  it("discovers all ten tasks, ordered", () => {
    const tasks = discoverTasks(TASKS_ROOT);
    expect(tasks.map((t) => t.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("every task validates (fixture, mission, engine-scripts present)", () => {
    for (const task of discoverTasks(TASKS_ROOT)) {
      const v = validateTask(task, { requireScripts: true });
      expect(v.issues, `${task.name}: ${v.issues.join("; ")}`).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it("runs task 01 end-to-end in mock mode and completes", async () => {
    const task = discoverTasks(TASKS_ROOT).find((t) => t.num === 1)!;
    const m = await runTask({ task, chainName: "cheap", chains, mock: true });
    expect(m.completed).toBe(true);
    expect(m.nodesPassed).toBe(1);
    expect(m.confabulations).toBe(0);
  });
});

describe("gates are ungameable", () => {
  it("cannot pass task 01 by editing the test — blast_radius denies it", async () => {
    const task = discoverTasks(TASKS_ROOT).find((t) => t.num === 1)!;
    const repo = mkdtempSync(join(tmpdir(), "squire-ungame-"));
    cpSync(task.fixtureDir, repo, { recursive: true });
    await initRepo(repo);
    const mission = parseMission(readFileSync(task.missionPath, "utf8"));

    // A cheating "agent": instead of fixing src/math.js, neuter the test.
    const cheat = new MockEngine({
      resolveScript: () => ({
        steps: [
          {
            tool: "write",
            args: {
              path: "test/math.test.js",
              content: 'const test=require("node:test");test("noop",()=>{});\n',
            },
          },
          { done: "rewrote the test to always pass" },
        ],
      }),
    });

    const result = await runMission({
      mission,
      chains,
      engine: cheat,
      workdir: repo,
      missionId: "ungame",
      tracePath: join(repo, ".squire", "trace.jsonl"),
    });

    // The write to test/ is outside blast_radius (src/**), so it is denied;
    // the real (still-failing) test runs and the node never passes.
    expect(result.completed).toBe(false);
    expect(result.nodes[0]!.blastDenied).toBeGreaterThanOrEqual(1);
    // the original test file must be intact
    expect(readFileSync(join(repo, "test", "math.test.js"), "utf8")).toContain("add sums two numbers");
  });
});
