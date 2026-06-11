import {
  readFileSync,
  existsSync,
  readdirSync,
  cpSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseMission, type ChainsFile } from "../contract/schema.js";
import { runMission } from "../harness/runner.js";
import { readTrace, summarize } from "../harness/trace.js";
import { initRepo } from "../harness/checkpoint.js";
import { MockEngine, fileScriptResolver } from "../engine/mock.js";
import { PiEngine } from "../engine/pi.js";
import type { Engine } from "../engine/types.js";
import type { TaskRef } from "./tasks.js";

export interface TaskValidation {
  task: string;
  ok: boolean;
  nodes: number;
  issues: string[];
}

/** Static validation used by --dry-run: mission parses, fixture present, scripts present (for mock). */
export function validateTask(task: TaskRef, opts: { requireScripts: boolean }): TaskValidation {
  const issues: string[] = [];
  let nodes = 0;
  if (!existsSync(task.fixtureDir) || readdirSync(task.fixtureDir).length === 0) {
    issues.push("fixture/ missing or empty");
  }
  try {
    const mission = parseMission(readFileSync(task.missionPath, "utf8"), task.missionPath);
    nodes = mission.nodes.length;
    if (mission.nodes.length < 1) issues.push("mission has no nodes");
    if (opts.requireScripts) {
      for (const node of mission.nodes) {
        const rung = join(task.scriptsDir, `${node.id}.json`);
        if (!existsSync(rung)) issues.push(`missing engine-script for node "${node.id}"`);
      }
    }
  } catch (err) {
    issues.push(`mission.yaml invalid: ${(err as Error).message}`);
  }
  return { task: task.name, ok: issues.length === 0, nodes, issues };
}

export interface TaskMetrics {
  taskNum: number;
  task: string;
  chain: string;
  completed: boolean;
  nodesPassed: number;
  nodesTotal: number;
  escalatedNodes: number; // nodes that reached rung >= 3
  retries: number; // total extra attempts beyond the first, summed across nodes
  confabulations: number;
  blastDenied: number;
  wallSeconds: number;
  costUsd: number;
  haltReason?: string;
  /** Path to the archived JSONL trace for this run (results/<runId>/<task>-<chain>.jsonl). */
  traceArchive?: string;
}

export interface RunTaskOptions {
  task: TaskRef;
  chainName: string;
  chains: ChainsFile;
  mock: boolean;
  apiKey?: string;
  baseUrl?: string;
  now?: () => number;
  keepTemp?: boolean;
  /** When set, the per-run trace is archived to <resultsDir>/<runId>/<task>-<chain>.jsonl. */
  runId?: string;
  resultsDir?: string;
}

/** Run one task on one chain in an isolated temp git repo (SPEC §12). */
export async function runTask(opts: RunTaskOptions): Promise<TaskMetrics> {
  const { task, chainName, chains, mock } = opts;
  const mission = parseMission(readFileSync(task.missionPath, "utf8"), task.missionPath);

  const workdir = mkdtempSync(join(tmpdir(), `squire-exp-${task.num}-`));
  const startedAt = Date.now();
  try {
    cpSync(task.fixtureDir, workdir, { recursive: true });
    await initRepo(workdir);

    const engine: Engine = mock
      ? new MockEngine({ resolveScript: fileScriptResolver(task.scriptsDir) })
      : new PiEngine();

    const missionId = `${task.name}-${chainName}`;
    const tracePath = join(workdir, ".squire", `trace-${missionId}.jsonl`);

    const result = await runMission({
      mission,
      chains,
      engine,
      workdir,
      missionId,
      tracePath,
      chainNameOverride: chainName,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      now: opts.now,
    });

    const summary = summarize(readTrace(tracePath));
    const escalatedNodes = summary.nodes.filter((n) => n.maxRung >= 3).length;
    const retries = summary.nodes.reduce((s, n) => s + Math.max(0, n.attempts - 1), 0);
    const confabulations = summary.nodes.reduce((s, n) => s + n.confabulations, 0);
    const blastDenied = summary.nodes.reduce((s, n) => s + n.blastDenied, 0);

    // Archive the trace before the temp dir is reaped (findings need it).
    let traceArchive: string | undefined;
    if (opts.runId && opts.resultsDir) {
      const dir = join(opts.resultsDir, opts.runId);
      mkdirSync(dir, { recursive: true });
      traceArchive = join(dir, `${task.name}-${chainName}.jsonl`);
      copyFileSync(tracePath, traceArchive);
    }

    return {
      taskNum: task.num,
      task: task.name,
      chain: chainName,
      completed: result.completed,
      nodesPassed: result.committedNodeIds.length,
      nodesTotal: mission.nodes.length,
      escalatedNodes,
      retries,
      confabulations,
      blastDenied,
      wallSeconds: (Date.now() - startedAt) / 1000,
      costUsd: result.totalCostUsd,
      haltReason: result.haltReason,
      traceArchive,
    };
  } finally {
    if (!opts.keepTemp) {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
    }
  }
}
