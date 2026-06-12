/**
 * The experiment (SPEC §12). The whole point: a benchmark table comparing a
 * cheap verified chain against a frontier-only chain on the same tasks.
 *
 *   pnpm experiment [--tasks 1..10] [--chains cheap,knight-only] [--dry-run] [--mock]
 *
 * --dry-run validates all missions + fixtures, prints the empty table schema,
 * and exits 0 (no API key, no network). This is gate #5.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChains, resolveChain } from "../src/contract/schema.js";
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
  "recovered",
  "rungHist",
  "escalated",
  "confab",
  "blastBlocks",
  "wall_s",
  "cost_usd",
  "trace",
] as const;

function rungHistStr(h: Record<string, number>): string {
  const keys = Object.keys(h).sort();
  return keys.length === 0 ? "-" : keys.map((r) => `r${r}:${h[r]}`).join(" ");
}

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const chainsPath = flags.value.get("chains-file")
    ? resolve(flags.value.get("chains-file")!)
    : CHAINS_PATH;
  const chains = parseChains(readFileSync(chainsPath, "utf8"), chainsPath);
  const allTasks = discoverTasks(TASKS_ROOT);
  const taskNums = parseTaskNums(flags.value.get("tasks"));
  const tasks = selectTasks(allTasks, taskNums);
  const mock = flags.bool.has("mock");
  const dryRun = flags.bool.has("dry-run");
  // The full live matrix includes the cheap-raw ablation; --mock defaults to the
  // two scripted chains (raw mode is a live ablation — it tests whether the raw
  // agent can self-decompose, which a scripted mock can't represent per task).
  const defaultChains = mock ? "cheap,knight-only" : "cheap-raw,cheap,knight-only";
  const chainNames = (flags.value.get("chains") ?? defaultChains)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

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
    // Validate that every requested chain resolves against chains.yaml.
    const badChains: string[] = [];
    for (const name of chainNames) {
      try {
        resolveChain(chains, name);
      } catch {
        badChains.push(name);
      }
    }
    if (badChains.length > 0) {
      process.stderr.write(`unknown chain(s): ${badChains.join(", ")}\n`);
      return 1;
    }
    process.stdout.write(`\nChains OK: ${chainNames.map((n) => `${n}(harness=${chains.chains[n]!.harness})`).join(", ")}\n`);
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
      // Raw mode under --mock needs a per-task "(raw).json" script; tasks don't
      // ship one (raw is a live ablation), so skip with a clear note.
      if (mock && chains.chains[chainName]?.harness === "off" && !existsSync(join(task.scriptsDir, "(raw).json"))) {
        process.stdout.write(`\n=== ${task.name} x ${chainName} (mock) — SKIP: raw mode is a live ablation (no (raw).json) ===\n`);
        continue;
      }
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
  const widths = [24, 12, 9, 7, 9, 12, 9, 6, 11, 7, 9, 24];
  const header = COLUMNS.map((c, i) => c.padEnd(widths[i] ?? 8)).join(" ");
  process.stdout.write("\n" + header + "\n" + "-".repeat(header.length) + "\n");
  for (const r of rows) {
    const cells = [
      r.task,
      r.chain,
      String(r.completed),
      `${r.nodesPassed}/${r.nodesTotal}`,
      String(r.recoveredNodes),
      rungHistStr(r.rungHistogram),
      String(r.escalatedNodes),
      String(r.confabulations),
      String(r.blastDenied),
      r.wallSeconds.toFixed(1),
      r.costUsd.toFixed(4),
      r.traceArchive ? basename(r.traceArchive) : "-",
    ];
    process.stdout.write(cells.map((c, i) => c.padEnd(widths[i] ?? 8)).join(" ") + "\n");
  }
}

interface ChainAgg {
  chain: string;
  missions: number;
  completed: number;
  nodesTotal: number;
  nodesPassed: number;
  recovered: number;
  escalated: number;
  confab: number;
  cost: number;
  costPerCompleted: number;
}

function aggregate(rows: TaskMetrics[], chain: string): ChainAgg {
  const r = rows.filter((x) => x.chain === chain);
  const completed = r.filter((x) => x.completed).length;
  const cost = r.reduce((s, x) => s + x.costUsd, 0);
  return {
    chain,
    missions: r.length,
    completed,
    nodesTotal: r.reduce((s, x) => s + x.nodesTotal, 0),
    nodesPassed: r.reduce((s, x) => s + x.nodesPassed, 0),
    recovered: r.reduce((s, x) => s + x.recoveredNodes, 0),
    escalated: r.reduce((s, x) => s + x.escalatedNodes, 0),
    confab: r.reduce((s, x) => s + x.confabulations, 0),
    cost,
    costPerCompleted: completed > 0 ? cost / completed : NaN,
  };
}

function pct(a: ChainAgg): number {
  return a.nodesTotal === 0 ? 0 : Math.round((a.nodesPassed / a.nodesTotal) * 100);
}

function printVerdict(rows: TaskMetrics[], chainNames: string[]): void {
  const present = chainNames.filter((c) => rows.some((r) => r.chain === c));
  const aggs = new Map(present.map((c) => [c, aggregate(rows, c)] as const));

  process.stdout.write("\n--- VERDICT ---\n");

  // Lead with the ablation delta: cheap-raw vs cheap.
  const raw = aggs.get("cheap-raw");
  const cheap = aggs.get("cheap");
  if (raw && cheap) {
    process.stdout.write(
      `ABLATION (harness lift): cheap-raw ${raw.completed}/${raw.missions} missions (${pct(raw)}% nodes) ` +
        `vs cheap ${cheap.completed}/${cheap.missions} (${pct(cheap)}% nodes) ` +
        `— +${cheap.completed - raw.completed} missions, +${pct(cheap) - pct(raw)} pts of nodes from the harness\n`,
    );
  } else {
    process.stdout.write("ABLATION: run --chains cheap-raw,cheap to see the harness lift\n");
  }

  // Cost per COMPLETED mission for all three chains.
  process.stdout.write("cost per COMPLETED mission:\n");
  for (const c of present) {
    const a = aggs.get(c)!;
    const cpc = Number.isFinite(a.costPerCompleted) ? `$${a.costPerCompleted.toFixed(4)}` : "n/a (0 completed)";
    process.stdout.write(`  ${c.padEnd(12)} ${a.completed}/${a.missions} completed, total $${a.cost.toFixed(4)}, ${cpc}/mission\n`);
  }

  // Ladder recovery + escalation on the cheap chain.
  if (cheap) {
    process.stdout.write(
      `ladder: ${cheap.recovered} node(s) recovered by escalation (failed rung 1, passed later); ${cheap.escalated} hit rung>=3; ${cheap.confab} confabulation flag(s)\n`,
    );
  }
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
        r.recoveredNodes,
        `"${rungHistStr(r.rungHistogram)}"`,
        r.escalatedNodes,
        r.confabulations,
        r.blastDenied,
        r.wallSeconds.toFixed(2),
        r.costUsd.toFixed(6),
        r.traceArchive ? basename(r.traceArchive) : "",
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
  const valued = ["tasks", "chains", "chains-file"];
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
