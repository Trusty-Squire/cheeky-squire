/**
 * calibrate.ts — run a task list LIVE against ONE chain and report how hard the
 * tasks actually are (Phase C deliverable).
 *
 *   pnpm calibrate [--tasks 11..20] [--chain cheap]
 *
 * Prints per-task node completion and a HARDENING REPORT that flags any task
 * whose node-completion is >= 90% — a "hard" benchmark task that the cheap
 * executor sails through is either too easy or has a gameable gate, and should
 * be hardened. This needs OPENROUTER_API_KEY and makes real calls; the human
 * runs it. It is NOT run by any gate.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChains } from "../src/contract/schema.js";
import { discoverTasks, selectTasks } from "../src/experiment/tasks.js";
import { runTask, type TaskMetrics } from "../src/experiment/run.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HARDEN_THRESHOLD = 0.9;

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const chains = parseChains(readFileSync(join(ROOT, "chains.yaml"), "utf8"));
  const chainName = flags.value.get("chain") ?? "cheap";
  const tasks = selectTasks(discoverTasks(join(ROOT, "tasks")), parseTaskNums(flags.value.get("tasks")));

  if (tasks.length === 0) {
    process.stderr.write("no tasks selected\n");
    return 1;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "OPENROUTER_API_KEY is required — calibrate runs LIVE against real models (the human runs this, no gate does)\n",
    );
    return 1;
  }

  const runId = `calibrate-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const resultsDir = join(ROOT, "results");
  process.stdout.write(`Calibrating ${tasks.length} task(s) live against "${chainName}"...\n\n`);

  const rows: TaskMetrics[] = [];
  for (const task of tasks) {
    process.stdout.write(`=== ${task.name} ===\n`);
    const m = await runTask({ task, chainName, chains, mock: false, apiKey, runId, resultsDir });
    rows.push(m);
    const pct = m.nodesTotal === 0 ? 0 : Math.round((m.nodesPassed / m.nodesTotal) * 100);
    process.stdout.write(
      `  ${m.nodesPassed}/${m.nodesTotal} nodes (${pct}%)  completed=${m.completed}  escalated=${m.escalatedNodes}  cost=$${m.costUsd.toFixed(4)}\n`,
    );
  }

  // Per-task table.
  const widths = [24, 9, 7, 9, 7, 9];
  const header = ["task", "nodes", "pct", "completed", "escal", "cost_usd"].map((c, i) => c.padEnd(widths[i]!)).join(" ");
  process.stdout.write("\n" + header + "\n" + "-".repeat(header.length) + "\n");
  for (const r of rows) {
    const pct = r.nodesTotal === 0 ? 0 : Math.round((r.nodesPassed / r.nodesTotal) * 100);
    process.stdout.write(
      [
        r.task,
        `${r.nodesPassed}/${r.nodesTotal}`,
        `${pct}%`,
        String(r.completed),
        String(r.escalatedNodes),
        r.costUsd.toFixed(4),
      ]
        .map((c, i) => c.padEnd(widths[i]!))
        .join(" ") + "\n",
    );
  }

  // Hardening report.
  const tooEasy = rows.filter((r) => r.nodesTotal > 0 && r.nodesPassed / r.nodesTotal >= HARDEN_THRESHOLD);
  process.stdout.write("\n--- HARDENING REPORT ---\n");
  if (tooEasy.length === 0) {
    process.stdout.write(`No task hit >= ${HARDEN_THRESHOLD * 100}% node completion on "${chainName}". The suite is suitably hard.\n`);
  } else {
    process.stdout.write(
      `${tooEasy.length} task(s) reached >= ${HARDEN_THRESHOLD * 100}% completion on "${chainName}" — harden them (add varied-input gates, mutation guards, or longer/poisoned chains):\n`,
    );
    for (const r of tooEasy) {
      const pct = Math.round((r.nodesPassed / r.nodesTotal) * 100);
      process.stdout.write(`  - ${r.task}: ${pct}% (${r.nodesPassed}/${r.nodesTotal})${r.escalatedNodes === 0 ? " with NO escalations" : ""}\n`);
    }
  }
  process.stdout.write(`\ntraces archived under ${join(resultsDir, runId)}/\n`);
  return 0;
}

function parseTaskNums(spec: string | undefined): number[] {
  if (!spec) return [];
  const nums = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.match(/^(\d+)\s*(?:\.\.|-)\s*(\d+)$/);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) nums.add(i);
    } else if (/^\d+$/.test(part.trim())) {
      nums.add(Number(part.trim()));
    }
  }
  return [...nums].sort((a, b) => a - b);
}

function parseFlags(args: string[]): { value: Map<string, string> } {
  const value = new Map<string, string>();
  const valued = ["tasks", "chain"];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (valued.includes(name)) value.set(name, args[++i] ?? "");
    }
  }
  return { value };
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`calibrate error: ${(err as Error).message}\n`);
    process.exit(1);
  });
