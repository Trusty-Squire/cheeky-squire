/**
 * Fixture setup / validation (SPEC §3, §11).
 *
 * The benchmark fixtures are committed as plain files under tasks/NN-name/fixture.
 * They are dependency-free Node micro-projects whose gates run via `node --test`
 * and `node -e`, so the experiment can copy each into a temp git repo and run
 * it with no install and no network.
 *
 * This script validates every task (fixture present, mission parses, mock
 * engine-scripts present) and prints a summary. It is also a convenient
 * smoke-check before a real experiment run.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTasks } from "../src/experiment/tasks.js";
import { validateTask } from "../src/experiment/run.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TASKS_ROOT = join(ROOT, "tasks");

function main(): number {
  const tasks = discoverTasks(TASKS_ROOT);
  if (tasks.length === 0) {
    process.stderr.write(`no tasks found under ${TASKS_ROOT}\n`);
    return 1;
  }
  let bad = 0;
  process.stdout.write(`Found ${tasks.length} task(s):\n`);
  for (const task of tasks) {
    const v = validateTask(task, { requireScripts: true });
    process.stdout.write(`  [${v.ok ? "ok" : "FAIL"}] ${task.name} — ${v.nodes} node(s)\n`);
    for (const issue of v.issues) process.stdout.write(`         - ${issue}\n`);
    if (!v.ok) bad += 1;
  }
  if (bad > 0) {
    process.stderr.write(`\n${bad} task(s) failed validation\n`);
    return 1;
  }
  process.stdout.write("\nAll fixtures valid.\n");
  return 0;
}

process.exit(main());
