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
    case "do":
      return cmdDo(rest);
    case "fix":
      return cmdFix(rest);
    case "spec":
      return cmdSpec(rest);
    case "talk":
      return cmdTalk(rest);
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
      "ser — Castellan: verified coding agent. Specs compile to gated loops.",
      "",
      "Usage:",
      "  ser talk [x.spec.yaml]    — the unified interface: talk; check/derive/run happen behind it",
      "  ser run <mission.yaml> [--mock] [--chain <name>] [--sandbox]",
      "  ser derive \"<goal>\" [--chain <name>] [--yes] [--out <file>]",
      "  ser trace <trace.jsonl>",
      "  ser do \"<goal>\" [--gate <cmd>] [--radius <glob>] [--budget <usd>]",
      "  ser fix \"<bug>\" [--test-cmd <cmd>] [--test-file <path>]",
      "  ser spec init|check|verify|talk <x.spec.yaml> [...]",
      "  ser validate <mission.yaml> [--chains <file>]",
      "  ser experiment [-- <experiment args>]",
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
  if (!missionPath) throw new SquireError("USAGE", "ser run <mission.yaml> [--mock]");
  const missionAbs = resolve(missionPath);
  if (!existsSync(missionAbs)) throw new SquireError("MISSION_NOT_FOUND", `mission not found: ${missionAbs}`);
  const missionDir = dirname(missionAbs);
  const mission = parseMission(readFileSync(missionAbs, "utf8"), missionAbs);
  return executeMissionObject(mission, missionDir, flags, basename(missionAbs).replace(/\.[^.]+$/, ""));
}

/** Shared execution core for run/do/fix: workdir prep, engine, adjudicator, result. */
async function executeMissionObject(
  mission: ReturnType<typeof parseMission>,
  missionDir: string,
  flags: Flags,
  missionBaseName: string,
): Promise<number> {
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

  const missionId = `${missionBaseName}-${chainName}-${Date.now().toString(36)}`;
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
    // Tier-4 human gates: interactive prompt when a TTY is attached; absent
    // otherwise so unattended runs fail loudly instead of self-approving.
    adjudicate: process.stdin.isTTY ? promptAdjudicator(workdir) : undefined,
  });

  process.stdout.write("\n" + summarizeTrace(tracePath) + "\n");
  if (result.completed) {
    process.stdout.write(`\nMISSION COMPLETE — ${result.committedNodeIds.length} node(s), $${result.totalCostUsd.toFixed(4)}\n`);
    return 0;
  }
  process.stdout.write(`\nMISSION HALTED — ${result.haltReason}\ntrace: ${tracePath}\n`);
  return 1;

}

async function cmdDo(args: string[]): Promise<number> {
  const flags = parseFlags(args, ["chain", "chains", "harness", "gate", "radius", "budget"]);
  const goal = flags.positional[0];
  if (!goal) throw new SquireError("USAGE", 'ser do "<goal>" [--gate <cmd>] [--radius <glob>]');
  const { buildDoMission } = await import("./contract/packs.js");
  const workdir = process.cwd();
  const mission = buildDoMission(goal, workdir, {
    gate: flags.value.get("gate"),
    radius: flags.value.get("radius") ? [flags.value.get("radius")!] : undefined,
    budgetUsd: flags.value.get("budget") ? Number(flags.value.get("budget")) : undefined,
    chain: flags.value.get("chain"),
  });
  return executeMissionObject(mission, workdir, flags, "do");
}

async function cmdFix(args: string[]): Promise<number> {
  const flags = parseFlags(args, ["chain", "chains", "harness", "test-cmd", "test-file", "radius", "budget"]);
  const bug = flags.positional[0];
  if (!bug) throw new SquireError("USAGE", 'ser fix "<bug description>" [--test-cmd <cmd>] [--test-file <path>]');
  const { buildFixMission } = await import("./contract/packs.js");
  const workdir = process.cwd();
  const mission = buildFixMission(bug, workdir, {
    testCmd: flags.value.get("test-cmd"),
    testFile: flags.value.get("test-file"),
    radius: flags.value.get("radius") ? [flags.value.get("radius")!] : undefined,
    budgetUsd: flags.value.get("budget") ? Number(flags.value.get("budget")) : undefined,
    chain: flags.value.get("chain"),
  });
  return executeMissionObject(mission, workdir, flags, "fix");
}

async function cmdSpec(args: string[]): Promise<number> {
  const sub = args[0];
  const { parseSpec } = await import("./contract/spec.js");
  const { checkSpec, verifyClaim } = await import("./contract/spec-session.js");
  const { stringify } = await import("yaml");
  const { writeFileSync: wf } = await import("node:fs");

  if (sub === "init") {
    const flags = parseFlags(args.slice(1), ["thesis"]);
    const file = flags.positional[0];
    if (!file) throw new SquireError("USAGE", 'ser spec init <name.spec.yaml> --thesis "<one paragraph>"');
    if (existsSync(resolve(file))) throw new SquireError("SPEC_EXISTS", `${file} already exists`);
    wf(
      resolve(file),
      stringify({
        thesis: flags.value.get("thesis") ?? "TODO: one paragraph — pinned; drift is flagged against this",
        scope_fence: [],
        requirements: [{ id: "R1", statement: "TODO", acceptance: { tier: 0 } }],
        decisions: [],
        claims: [],
        open_questions: [{ id: "Q1", text: "what is the first requirement's objective check?", blocking: true }],
      }),
    );
    process.stdout.write(`initialized ${file} — talk with: ser spec talk ${file}\n`);
    return 0;
  }

  if (sub === "check") {
    const file = args[1];
    if (!file) throw new SquireError("USAGE", "ser spec check <x.spec.yaml>");
    const spec = parseSpec(readFileSync(resolve(file), "utf8"), file);
    const { ok, lines } = checkSpec(spec);
    process.stdout.write(lines.join("\n") + "\n");
    return ok ? 0 : 1;
  }

  if (sub === "verify") {
    const flags = parseFlags(args.slice(1), ["chain", "chains"]);
    const [file, claimId] = flags.positional;
    if (!file || !claimId) throw new SquireError("USAGE", "ser spec verify <x.spec.yaml> <claim-id>");
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new SquireError("NO_API_KEY", "OPENROUTER_API_KEY required for ser spec verify");
    const { OpenRouterClient } = await import("./llm/openrouter.js");
    const { loadChainsForDerive } = await import("./contract/derive.js");
    const chains = loadChainsForDerive(process.cwd(), flags.value.get("chains"));
    const chain = resolveChain(chains, flags.value.get("chain") ?? "cheap");
    const spec = parseSpec(readFileSync(resolve(file), "utf8"), file);
    const llm = new OpenRouterClient({ apiKey, baseUrl: process.env.OPENROUTER_BASE_URL });
    const r = await verifyClaim(spec, claimId, llm, chain.executor);
    wf(resolve(file), stringify(r.spec));
    process.stdout.write(`${claimId}: ${r.verdict}\n  ${r.evidence}\n`);
    return r.verdict === "verified" ? 0 : 1;
  }

  if (sub === "talk") return cmdTalk(args.slice(1));

  throw new SquireError("USAGE", "ser spec init|check|verify|talk <x.spec.yaml>");
}

/**
 * The unified interface (`ser talk`): one conversation across all tools.
 * The mapper records deltas and may REQUEST a harness command (check/verify/
 * derive/run/status); the harness executes it mechanically and prints its own
 * report. The differences between the tools happen in the background.
 */
async function cmdTalk(args: string[]): Promise<number> {
  const flags = parseFlags(args, ["chain", "chains", "budget"]);
  const { SpecSession } = await import("./contract/spec-session.js");
  const { dispatchAction } = await import("./contract/talk.js");

  let file = flags.positional[0];
  if (!file) {
    const { readdirSync } = await import("node:fs");
    const specs = readdirSync(process.cwd()).filter((f) => f.endsWith(".spec.yaml"));
    if (specs.length === 1) file = specs[0]!;
    else if (specs.length === 0) {
      throw new SquireError("USAGE", 'no .spec.yaml here — start one: ser spec init <name.spec.yaml> --thesis "..."');
    } else {
      throw new SquireError("USAGE", `multiple specs here (${specs.join(", ")}) — ser talk <file>`);
    }
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new SquireError("NO_API_KEY", "OPENROUTER_API_KEY required for ser talk");
  const { OpenRouterClient } = await import("./llm/openrouter.js");
  const { loadChainsForDerive } = await import("./contract/derive.js");
  const chains = loadChainsForDerive(process.cwd(), flags.value.get("chains"));
  const chainName = flags.value.get("chain") ?? "cheap";
  const chain = resolveChain(chains, chainName);
  const llm = new OpenRouterClient({ apiKey, baseUrl: process.env.OPENROUTER_BASE_URL });
  const session = new SpecSession({
    path: resolve(file),
    llm,
    executorModel: chain.executor,
    knightModel: chain.knight,
  });
  const actionCtx = {
    specPath: session.path,
    llm,
    executorModel: chain.executor,
    chainName,
    budgetUsd: flags.value.get("budget") ? Number(flags.value.get("budget")) : undefined,
    confirm: async (q: string) => /^y(es)?\b/i.test((await ask(`${q} [y/N]: `)).trim()),
    execute: async (missionPath: string) => {
      const mission = parseMission(readFileSync(missionPath, "utf8"), missionPath);
      return executeMissionObject(mission, dirname(missionPath), flags, basename(missionPath).replace(/\.[^.]+$/, ""));
    },
  };
  process.stdout.write("ser — talk normally; the notebook updates itself. 'undo' reverts, empty line exits.\n");
  let undoStack: string[] = [];
  for (;;) {
    const msg = (await ask("you> ")).trim();
    if (!msg) return 0;
    if (msg === "undo") {
      const prev = undoStack.pop();
      if (!prev) { process.stdout.write("  nothing to undo\n"); continue; }
      const { writeFileSync: w } = await import("node:fs");
      w(session.path, prev);
      session.reject(); // repeated undos escalate the model
      process.stdout.write(`  reverted (next turn on ${session.currentModel()})\n`);
      continue;
    }
    const before = readFileSync(session.path, "utf8");
    try {
      const batch = await session.turn(msg);
      if (batch.reply) process.stdout.write(`\n${batch.reply}\n`);
      if (batch.deltas.length > 0) {
        const { applied, dropped } = await session.acceptLenient(batch);
        if (applied.length > 0) {
          undoStack.push(before);
          if (undoStack.length > 20) undoStack = undoStack.slice(-20);
          const summary = applied
            .map((d) => `${d.op === "add" ? "+" : d.op === "remove" ? "-" : "~"}${d.section}${d.id ? ":" + d.id : ""}${d.drift ? "⚠drift" : ""}`)
            .join(" ");
          process.stdout.write(`  [spec ${summary}]\n`);
        }
        for (const drop of dropped) {
          process.stdout.write(`  [edit dropped (${drop.delta.section}${drop.delta.id ? ":" + drop.delta.id : ""}): ${drop.reason}]\n`);
        }
      }
      if (batch.action !== "none") {
        try {
          const lines = await dispatchAction(batch.action, batch.action_arg, actionCtx);
          for (const line of lines) process.stdout.write(`${line}\n`);
        } catch (err) {
          process.stdout.write(`  [${batch.action} failed: ${(err as Error).message.split("\n")[0]} — keep talking]\n`);
        }
      }
      if (batch.question) process.stdout.write(`? ${batch.question}\n`);
    } catch (err) {
      // The conversation never dies for bookkeeping reasons.
      process.stdout.write(`  [turn failed: ${(err as Error).message.split("\n")[0]} — keep talking]\n`);
    }
  }
}

async function cmdTrace(args: string[]): Promise<number> {
  const flags = parseFlags(args, []);
  const path = flags.positional[0];
  if (!path) throw new SquireError("USAGE", "ser trace <trace.jsonl>");
  process.stdout.write(summarizeTrace(resolve(path)) + "\n");
  return 0;
}

async function cmdDerive(args: string[]): Promise<number> {
  // v2 herald pipeline (SPEC-v0.2 §6); v1 remains importable for tests.
  const { runDeriveV2 } = await import("./contract/derive2.js");
  return runDeriveV2(args);
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
  if (!missionPath) throw new SquireError("USAGE", "ser validate <mission.yaml> [--chains <file>]");
  
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


/** Interactive tier-4 adjudicator: show the artifact path, take approve/reject + reason. */
function promptAdjudicator(workdir: string): import("./harness/gates.js").Adjudicator {
  return async ({ nodeId, artifact }) => {
    process.stdout.write(`\n[human gate] node "${nodeId}" — review artifact: ${join(workdir, artifact)}\n`);
    const answer = await ask(`approve? [y/N + optional reason]: `);
    const approved = /^y(es)?\b/i.test(answer.trim());
    const reason = answer.trim().replace(/^y(es)?\s*/i, "").replace(/^n(o)?\s*/i, "") || (approved ? "approved" : "rejected");
    return { approved, reason, by: process.env.USER ?? "human" };
  };
}

function ask(prompt: string): Promise<string> {
  return new Promise((resolveP) => {
    process.stdout.write(prompt);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => {
      process.stdin.pause();
      resolveP(String(d));
    });
  });
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
