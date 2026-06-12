#!/usr/bin/env node
import { readFileSync, existsSync, cpSync, mkdtempSync } from "node:fs";
import { dirname, resolve, join, basename, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { parseMission, parseChains, resolveChain, type ChainsFile } from "./contract/schema.js";
import { runMission } from "./harness/runner.js";
import { summarizeTrace } from "./harness/trace.js";
import { MockEngine, fileScriptResolver } from "./engine/mock.js";
import { initRepo, isClean } from "./harness/checkpoint.js";
import { SquireError } from "./errors.js";
import type { Engine } from "./engine/types.js";
import { validateMissionFile } from "./contract/validate.js";

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "run":
      return cmdRun(rest);
    case "trace":
      return cmdTrace(rest);
    case "derive":
      return cmdDerive(rest);
    case "experiment":
      return cmdExperiment(rest);
    case "validate":
      return cmdValidate(rest);
    case undefined:
    case "-h":
    case "--help":
      printUsage();
      return command === undefined ? 1 : 0;
    default:
      process.stderr.write(`unknown command: ${command}\n`);
      printUsage();
      return 1;
  }
}

function printUsage(): void {
  process.stdout.write(
    [
      "squire — a verification harness for cheap LLMs on long coding tasks",
      "",
      "Usage:",
      "  squire run <mission.yaml> [--mock] [--chain <name>] [--sandbox]",
      "  squire derive \"<goal>\" [--chain <name>] [--yes] [--out <file>]",
      "  squire trace <trace.jsonl>",
      "  squire validate <mission.yaml> [--chains <file>]",
      "  squire experiment [-- <experiment args>]",
      "",
    ].join("\n"),
  );
}

interface Flags {
  positional: string[];
  bool: Set<string>;
  value: Map<string, string>;
}

function parseFlags(args: string[], valued: string[]): Flags {
  const positional: string[] = [];
  const bool = new Set<string>();
  const value = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (valued.includes(name)) {
        value.set(name, args[++i] ?? "");
      } else {
        bool.add(name);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, bool, value };
}

function loadChains(missionDir: string, explicit?: string): { chains: ChainsFile; path: string } {
  const candidates = [
    explicit,
    join(process.cwd(), "chains.yaml"),
    join(missionDir, "chains.yaml"),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    const p = isAbsolute(candidate) ? candidate : resolve(candidate);
    if (existsSync(p)) return { chains: parseChains(readFileSync(p, "utf8"), p), path: p };
  }
  throw new SquireError("CHAINS_NOT_FOUND", `chains.yaml not found (looked in ${candidates.join(", ")})`);
}

async function cmdRun(args: string[]): Promise<number> {
  const flags = parseFlags(args, ["chain", "chains", "harness"]);
  const missionPath = flags.positional[0];
  if (!missionPath) throw new SquireError("USAGE", "squire run <mission.yaml> [--mock]");
  const missionAbs = resolve(missionPath);
  if (!existsSync(missionAbs)) throw new SquireError("MISSION_NOT_FOUND", `mission not found: ${missionAbs}`);
  const missionDir = dirname(missionAbs);
  const mission = parseMission(readFileSync(missionAbs, "utf8"), missionAbs);
  const { chains } = loadChains(missionDir, flags.value.get("chains"));
  const chainName = flags.value.get("chain") ?? mission.chain;
  const chain = resolveChain(chains, chainName);

  const declaredWorkdir = resolve(missionDir, mission.workdir);
  const useMock = flags.bool.has("mock");

  // Establish an effective workdir that is a real git repo. If the declared
  // workdir is not a git repo (or --sandbox is given), copy it to a temp dir
  // and git-init a baseline there, so the harness never mutates the source.
  const isRepo = existsSync(join(declaredWorkdir, ".git"));
  let workdir = declaredWorkdir;
  let sandboxed = false;
  if (!isRepo || flags.bool.has("sandbox")) {
    workdir = mkdtempSync(join(tmpdir(), "squire-run-"));
    cpSync(declaredWorkdir, workdir, {
      recursive: true,
      filter: (src) => !src.includes(`${"/"}node_modules`) && !src.endsWith(`${"/"}.git`),
    });
    await initRepo(workdir);
    sandboxed = true;
  } else if (!(await isClean(workdir))) {
    throw new SquireError(
      "DIRTY_WORKDIR",
      `workdir has uncommitted changes: ${workdir}. Commit or stash before running (the harness commits/resets per node).`,
    );
  }

  const missionId = `${basename(missionAbs).replace(/\.[^.]+$/, "")}-${chainName}-${Date.now().toString(36)}`;
  const tracePath = join(workdir, ".squire", `trace-${missionId}.jsonl`);

  let engine: Engine;
  if (useMock) {
    engine = new MockEngine({ resolveScript: fileScriptResolver(join(missionDir, "engine-scripts")) });
  } else {
    const { PiEngine } = await import("./engine/pi.js");
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new SquireError("NO_API_KEY", "OPENROUTER_API_KEY is required for a real run (use --mock otherwise)");
    engine = new PiEngine();
  }

  // Resolve harness mode: --harness <on|off> overrides the chain's setting.
  const harnessFlag = flags.value.get("harness");
  if (harnessFlag && harnessFlag !== "on" && harnessFlag !== "off") {
    throw new SquireError("USAGE", `--harness must be "on" or "off" (got "${harnessFlag}")`);
  }
  const harnessMode = (harnessFlag as "on" | "off" | undefined) ?? chain.harness;

  // Four-line readback (SPEC §8 style, applied to run as well).
  process.stdout.write(
    [
      `goal:    ${mission.goal}`,
      `chain:   ${chainName} (executor=${chain.executor}, knight=${chain.knight})`,
      `harness: ${harnessMode}${harnessMode === "off" ? " (ablation: raw, goal-only)" : ""}`,
      `budget:  $${mission.budget_usd}  over ${mission.nodes.length} node(s)`,
      `workdir: ${workdir}${sandboxed ? " (sandbox copy)" : ""}`,
      "",
    ].join("\n"),
  );

  const result = await runMission({
    mission,
    chains,
    engine,
    workdir,
    missionId,
    tracePath,
    chainNameOverride: chainName,
    harnessMode,
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_BASE_URL,
    log: (line) => process.stdout.write(line + "\n"),
  });

  process.stdout.write("\n" + summarizeTrace(tracePath) + "\n");
  if (result.completed) {
    process.stdout.write(`\nMISSION COMPLETE — ${result.committedNodeIds.length} node(s), $${result.totalCostUsd.toFixed(4)}\n`);
    return 0;
  }
  process.stdout.write(`\nMISSION HALTED — ${result.haltReason}\ntrace: ${tracePath}\n`);
  return 1;
}

async function cmdTrace(args: string[]): Promise<number> {
  const flags = parseFlags(args, []);
  const path = flags.positional[0];
  if (!path) throw new SquireError("USAGE", "squire trace <trace.jsonl>");
  process.stdout.write(summarizeTrace(resolve(path)) + "\n");
  return 0;
}

async function cmdDerive(args: string[]): Promise<number> {
  const { runDerive } = await import("./contract/derive.js");
  return runDerive(args);
}

async function cmdExperiment(args: string[]): Promise<number> {
  // Delegate to the experiment script (the benchmark entrypoint, SPEC §12).
  const { execa } = await import("execa");
  const script = resolve(dirname(new URL(import.meta.url).pathname), "..", "scripts", "experiment.ts");
  const result = await execa("npx", ["tsx", script, ...args], { stdio: "inherit", reject: false });
  return result.exitCode ?? 1;
}

async function cmdValidate(args: string[]): Promise<number> {
  const flags = parseFlags(args, ["chains"]);
  const missionPath = flags.positional[0];
  if (!missionPath) throw new SquireError("USAGE", "squire validate <mission.yaml> [--chains <file>]");
  
  const missionAbs = resolve(missionPath);
  if (!existsSync(missionAbs)) throw new SquireError("MISSION_NOT_FOUND", `mission not found: ${missionAbs}`);
  
  const missionDir = dirname(missionAbs);
  const { path: chainsPath } = loadChains(missionDir, flags.value.get("chains"));
  
  const result = validateMissionFile(missionAbs, chainsPath);
  
  // Print one line per issue prefixed "error:" or "warn:" (include the nodeId when present)
  for (const issue of result.issues) {
    const prefix = `${issue.level}:`;
    const nodeIdPart = issue.nodeId ? ` [node:${issue.nodeId}]` : "";
    process.stdout.write(`${prefix}${nodeIdPart} ${issue.message}\n`);
  }
  
  // Print final summary line
  const errorCount = result.issues.filter(i => i.level === "error").length;
  const warnCount = result.issues.filter(i => i.level === "warn").length;
  process.stdout.write(`validation complete: ${errorCount} error(s), ${warnCount} warning(s)\n`);
  
  // Return exit code 0 when the report is ok (warnings alone are fine), 1 otherwise
  return errorCount > 0 ? 1 : 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof SquireError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      if (err.tracePath) process.stderr.write(`trace: ${err.tracePath}\n`);
    } else {
      process.stderr.write(`error: ${(err as Error).message}\n`);
    }
    process.exit(1);
  });
