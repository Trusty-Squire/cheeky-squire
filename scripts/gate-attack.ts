/**
 * gate-attack (SPEC-v0.2 §9.2) — automated null-solution attacks against a
 * mission's gates: vacuous-pass (gate green with zero work) and guard-tamper
 * (diff-guards that don't hold). Hermetic: no LLM, no network.
 *
 *   pnpm gate-attack <mission.yaml> <fixtureDir>
 *   pnpm gate-attack --tasks 1..20      # attack every benchmark mission
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMission } from "../src/contract/schema.js";
import { attackMissionGates } from "../src/experiment/gate-attack.js";
import { discoverTasks, selectTasks } from "../src/experiment/tasks.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(argv: string[]): Promise<number> {
  const targets: { name: string; missionPath: string; fixtureDir: string }[] = [];
  if (argv[0] === "--tasks") {
    const nums = new Set<number>();
    for (const part of (argv[1] ?? "").split(",")) {
      const m = part.match(/^(\d+)\s*(?:\.\.|-)\s*(\d+)$/);
      if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) nums.add(i);
      else if (/^\d+$/.test(part.trim())) nums.add(Number(part.trim()));
    }
    for (const t of selectTasks(discoverTasks(join(ROOT, "tasks")), [...nums])) targets.push(t);
  } else if (argv[0] && argv[1]) {
    targets.push({ name: argv[0], missionPath: resolve(argv[0]), fixtureDir: resolve(argv[1]) });
  } else {
    process.stderr.write("usage: gate-attack <mission.yaml> <fixtureDir> | --tasks 1..20\n");
    return 1;
  }

  let fails = 0, warns = 0;
  for (const t of targets) {
    const mission = parseMission(readFileSync(t.missionPath, "utf8"), t.missionPath);
    const findings = await attackMissionGates(mission, t.fixtureDir);
    for (const f of findings) {
      process.stdout.write(`${f.severity.toUpperCase()} ${t.name} ${f.node} [${f.attack}]: ${f.detail}\n`);
      if (f.severity === "fail") fails++; else warns++;
    }
  }
  process.stdout.write(`\n--- GATE ATTACK ---\nfails: ${fails} (gate: 0)  warns: ${warns} (review derived plans with many)\n`);
  return fails === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then((c) => process.exit(c));
