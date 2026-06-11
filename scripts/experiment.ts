/**
 * The experiment (SPEC §12). The whole point: a benchmark table comparing a
 * cheap verified chain against a frontier-only chain on the same tasks.
 *
 *   pnpm experiment [--tasks 1..10] [--chains cheap,knight-only] [--dry-run] [--mock]
 *
 * --dry-run validates all missions + fixtures, prints the empty table schema,
 * and exits 0 (no API key, no network). This is gate #5.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChains } from "../src/contract/schema.js";
import { discoverTasks, selectTasks } from "../src/experiment/tasks.js";
import { validateTask, runTask, type TaskMetrics } from "../src/experiment/run.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TASKS_ROOT = join(ROOT, "tasks");
const CHAINS_PATH = join(ROOT, "chains.yaml");

const COLUMNS = [
  "task",
  "chain",
  "completed",
  "nodes",
  "escalated",
  "retries",
  "confab",
  "blastDenied",
  "wall_s",
  "cost_usd",
] as const;

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const chains = parseChains(readFileSync(CHAINS_PATH, "utf8"), CHAINS_PATH);
  const allTasks = discoverTasks(TASKS_ROOT);
  const taskNums = parseTaskNums(flags.value.get("tasks"));
  const tasks = selectTasks(allTasks, taskNums);
  const chainNames = (flags.value.get("chains") ?? "cheap,knight-only")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mock = flags.bool.has("mock");
  const dryRun = flags.bool.has("dry-run");

  if (tasks.length === 0) {
    process.stderr.write(`no tasks found under ${TASKS_ROOT}\n`);
    return 1;
  }

  // Validate everything first.
  let invalid = 0;
  process.stdout.write(`Validating ${tasks.length} task(s)...\n`);
  for (const task of tasks) {
    const v = validateTask(task, { requireScripts: mock });
    const status = v.ok ? "ok" : "FAIL";
    process.stdout.write(`  [${status}] ${task.name} (${v.nodes} nodes)\n`);
    for (const issue of v.issues) process.stdout.write(`         - ${issue}\n`);
    if (!v.ok) invalid += 1;
  }
  if (invalid > 0) {
    process.stderr.write(`${invalid} task(s) failed validation\n`);
    return 1;
  }

  if (dryRun) {
    process.stdout.write("\nDRY RUN — result table schema:\n");
    process.stdout.write(COLUMNS.join(",") + "\n");
    process.stdout.write("(empty: the real run needs OPENROUTER_API_KEY and is performed by the human)\n");
    process.stdout.write(`\nWould run ${tasks.length} task(s) x ${chainNames.length} chain(s) = ${tasks.length * chainNames.length} mission(s).\n`);
    return 0;
  }

  if (!mock && !process.env.OPENROUTER_API_KEY) {
    process.stderr.write("OPENROUTER_API_KEY is required for a real experiment run (or pass --mock / --dry-run)\n");
    return 1;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const resultsDir = join(ROOT, "results");
  const rows: TaskMetrics[] = [];
  for (const task of tasks) {
    for (const chainName of chainNames) {
      process.stdout.write(`\n=== ${task.name} x ${chainName}${mock ? " (mock)" : ""} ===\n`);
      const m = await runTask({ task, chainName, chains, mock, apiKey, runId, resultsDir });
      rows.push(m);
      process.stdout.write(
        `  completed=${m.completed} nodes=${m.nodesPassed}/${m.nodesTotal} escalated=${m.escalatedNodes} cost=$${m.costUsd.toFixed(4)}\n`,
      );
    }
  }
  process.stdout.write(`\ntraces archived under ${join(resultsDir, runId)}/\n`);

  printTable(rows);
  const csvPath = writeCsv(rows);
  printVerdict(rows, chainNames);
  process.stdout.write(`\nresults written to ${csvPath}\n`);
  return 0;
}

function printTable(rows: TaskMetrics[]): void {
  const widths = [22, 12, 9, 7, 9, 7, 6, 11, 7, 9];
  const header = COLUMNS.map((c, i) => c.padEnd(widths[i] ?? 8)).join(" ");
  process.stdout.write("\n" + header + "\n" + "-".repeat(header.length) + "\n");
  for (const r of rows) {
    const cells = [
      r.task,
      r.chain,
      String(r.completed),
      `${r.nodesPassed}/${r.nodesTotal}`,
      String(r.escalatedNodes),
      String(r.retries),
      String(r.confabulations),
      String(r.blastDenied),
      r.wallSeconds.toFixed(1),
      r.costUsd.toFixed(4),
    ];
    process.stdout.write(cells.map((c, i) => c.padEnd(widths[i] ?? 8)).join(" ") + "\n");
  }
}

function printVerdict(rows: TaskMetrics[], chainNames: string[]): void {
  const cheapName = chainNames.find((c) => c !== "knight-only") ?? chainNames[0]!;
  const knightName = chainNames.find((c) => c === "knight-only");

  const cheapRows = rows.filter((r) => r.chain === cheapName);
  const cheapMissions = cheapRows.length;
  const cheapCompleted = cheapRows.filter((r) => r.completed).length;
  const cheapNodesTotal = cheapRows.reduce((s, r) => s + r.nodesTotal, 0);
  const cheapNodesPassed = cheapRows.reduce((s, r) => s + r.nodesPassed, 0);
  const nodePct = cheapNodesTotal === 0 ? 0 : Math.round((cheapNodesPassed / cheapNodesTotal) * 100);
  const escalated = cheapRows.reduce((s, r) => s + r.escalatedNodes, 0);
  const cheapCost = cheapRows.reduce((s, r) => s + r.costUsd, 0);
  const knightCost = knightName
    ? rows.filter((r) => r.chain === knightName).reduce((s, r) => s + r.costUsd, 0)
    : 0;
  const ratio = knightCost > 0 ? (cheapCost / knightCost).toFixed(3) : "n/a";

  process.stdout.write("\n--- VERDICT ---\n");
  process.stdout.write(
    `cheap-chain completion: ${cheapCompleted}/${cheapMissions} missions, ${nodePct}% of nodes\n`,
  );
  process.stdout.write(`escalation rate: ${escalated} node(s) hit rung>=3\n`);
  process.stdout.write(
    `cost: $${cheapCost.toFixed(4)} cheap vs $${knightCost.toFixed(4)} knight  (ratio ${ratio})\n`,
  );
}

function writeCsv(rows: TaskMetrics[]): string {
  const dir = join(ROOT, "results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `experiment-${stamp}.csv`);
  const lines = [COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.task,
        r.chain,
        r.completed,
        `${r.nodesPassed}/${r.nodesTotal}`,
        r.escalatedNodes,
        r.retries,
        r.confabulations,
        r.blastDenied,
        r.wallSeconds.toFixed(2),
        r.costUsd.toFixed(6),
      ].join(","),
    );
  }
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

function parseTaskNums(spec: string | undefined): number[] {
  if (!spec) return [];
  const nums = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.match(/^(\d+)\s*(?:\.\.|-)\s*(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      for (let i = lo; i <= hi; i++) nums.add(i);
    } else if (/^\d+$/.test(part.trim())) {
      nums.add(Number(part.trim()));
    }
  }
  return [...nums].sort((a, b) => a - b);
}

function parseFlags(args: string[]): { bool: Set<string>; value: Map<string, string> } {
  const bool = new Set<string>();
  const value = new Map<string, string>();
  const valued = ["tasks", "chains"];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (valued.includes(name)) value.set(name, args[++i] ?? "");
      else bool.add(name);
    }
  }
  return { bool, value };
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`experiment error: ${(err as Error).message}\n`);
    process.exit(1);
  });
