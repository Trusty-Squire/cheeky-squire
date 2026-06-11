import type { ChainsFile, Mission, MissionNode } from "../contract/schema.js";
import { resolveChain, topoSort } from "../contract/schema.js";
import type { Engine, AttemptRecord, ToolCallRecord, ToolName } from "../engine/types.js";
import { Trace } from "./trace.js";
import { packContext } from "./context.js";
import { reconcile } from "./reconcile.js";
import { runGate, DEFAULT_GATE_TIMEOUT_MS } from "./gates.js";
import { BudgetMeter } from "./budget.js";
import { ladder, buildFailureContext, type FailureInfo } from "./escalate.js";
import {
  head,
  commitNode,
  resetTo,
  changedFilesSince,
  diffSince,
  addGitExclude,
} from "./checkpoint.js";

/** Executor system prompt — Appendix B, verbatim. */
export const EXECUTOR_SYSTEM_PROMPT = `You are a Squire: a focused coding agent executing ONE task.
You have four tools: read, write, edit, bash.
Work only within the paths you are told are writable.
Run the check command yourself before declaring done; if it
fails, fix and re-run. Declare done only when it exits 0.
Your final message: one short paragraph stating what changed
(file list) and the check result. Claim nothing you did not do;
your tool calls are audited against your claims.`;

export interface NodeOutcome {
  nodeId: string;
  passed: boolean;
  attempts: number;
  maxRung: number;
  blastDenied: number;
  confabulations: number;
  costUsd: number;
  gateExitCode?: number;
}

export interface MissionResult {
  missionId: string;
  completed: boolean;
  halted: boolean;
  haltReason?: string;
  nodes: NodeOutcome[];
  committedNodeIds: string[];
  totalCostUsd: number;
  tracePath: string;
}

export interface RunMissionOptions {
  mission: Mission;
  chains: ChainsFile;
  engine: Engine;
  /** Effective working directory: a ready git repo. */
  workdir: string;
  missionId: string;
  tracePath: string;
  chainNameOverride?: string;
  apiKey?: string;
  baseUrl?: string;
  gateTimeoutMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * Mission executor — the node state machine (SPEC §5).
 * PENDING → PACKED → RUNNING → RECONCILING → GATING → COMMITTED | RESET → (escalate | HALT).
 */
export async function runMission(opts: RunMissionOptions): Promise<MissionResult> {
  const { mission, chains, engine, workdir, missionId, tracePath } = opts;
  const log = opts.log ?? (() => {});
  const gateTimeoutMs = opts.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
  const chainName = opts.chainNameOverride ?? mission.chain;
  const chain = resolveChain(chains, chainName);
  const rungs = ladder(chain);

  // Keep harness artifacts out of git: never staged by `git add -A`, never
  // removed by `git clean -fd` during a node reset.
  addGitExclude(workdir, [".squire/", ".squire"]);

  const trace = new Trace(tracePath, missionId, { now: opts.now });
  const budget = new BudgetMeter(chains.prices, mission.budget_usd);

  trace.append("mission_start", {
    payload: { goal: mission.goal, chain: chainName, budgetUsd: mission.budget_usd, workdir },
    costUsdSoFar: 0,
  });

  let lastGreen = await head(workdir);
  const order = topoSort(mission.nodes);
  const committed = new Set<string>();
  const outcomes: NodeOutcome[] = [];
  let halted = false;
  let haltReason: string | undefined;

  for (const node of order) {
    if (halted) break;

    // A node runs only when all deps are COMMITTED (topo order guarantees
    // deps precede; if any failed we'd already have halted).
    if (!node.deps.every((d) => committed.has(d))) {
      halted = true;
      haltReason = `node "${node.id}" cannot run: unmet deps`;
      break;
    }

    budget.beginNode(node.budget_usd);
    const outcome: NodeOutcome = {
      nodeId: node.id,
      passed: false,
      attempts: 0,
      maxRung: 0,
      blastDenied: 0,
      confabulations: 0,
      costUsd: 0,
    };
    outcomes.push(outcome);

    let failure: FailureInfo | undefined;
    let priorDiff: string | undefined;

    for (const rung of rungs) {
      outcome.attempts = rung.rung;
      outcome.maxRung = rung.rung;
      trace.append("node_start", {
        nodeId: node.id,
        attempt: rung.rung,
        rung: rung.rung,
        payload: { model: rung.model },
        costUsdSoFar: budget.globalSpent(),
      });

      // Each attempt is preceded by a reset to the last green checkpoint.
      // For rung > 1 this reverts the previous failed attempt (RESET state).
      await resetTo(workdir, lastGreen);
      if (rung.rung > 1) {
        trace.append("reset", {
          nodeId: node.id,
          rung: rung.rung,
          payload: { to: lastGreen },
          costUsdSoFar: budget.globalSpent(),
        });
      }

      const pack = packContext({
        workdir,
        globs: node.context_globs,
        maxTokens: node.max_context_tokens,
      });
      trace.append("pack", {
        nodeId: node.id,
        rung: rung.rung,
        payload: {
          files: pack.files.map((f) => f.path),
          truncated: pack.truncated,
          droppedFiles: pack.droppedFiles,
          estTokens: pack.estTokens,
        },
        costUsdSoFar: budget.globalSpent(),
      });

      let brief = node.brief;
      if (rung.addFailureContext && failure) {
        brief +=
          "\n\n" +
          buildFailureContext({
            ...failure,
            priorDiff: rung.addPriorDiff ? priorDiff : undefined,
          });
      }

      const req = {
        systemPrompt: EXECUTOR_SYSTEM_PROMPT,
        brief,
        files: pack.files,
        cwd: workdir,
        model: { slug: rung.model, apiKey: opts.apiKey, baseUrl: opts.baseUrl },
        tools: { blastRadius: node.blast_radius },
        maxTokens: node.max_context_tokens,
        nodeId: node.id,
        rung: rung.rung,
      };

      const consumed = await consumeAttempt(engine.runAttempt(req), {
        trace,
        node,
        rungModel: rung.model,
        rungNumber: rung.rung,
        budget,
      });
      const record = consumed.record;
      outcome.blastDenied += record.blastDeniedCount;
      outcome.costUsd = budget.nodeSpent();

      // Global hard cap → MISSION_HALTED immediately, state preserved.
      if (consumed.globalBudgetExceeded) {
        trace.append("budget_stop", {
          nodeId: node.id,
          rung: rung.rung,
          payload: { scope: "global", globalUsd: budget.globalSpent(), capUsd: mission.budget_usd },
          costUsdSoFar: budget.globalSpent(),
        });
        halted = true;
        haltReason = `global budget cap $${mission.budget_usd} exceeded`;
        break;
      }

      const changed = await changedFilesSince(workdir, lastGreen);
      const rec = reconcile({
        blastRadius: node.blast_radius,
        doneCheck: node.done_check,
        changedFiles: changed,
        record,
      });
      trace.append("reconcile", {
        nodeId: node.id,
        rung: rung.rung,
        payload: {
          violations: rec.violations,
          missingFromDiff: rec.missingFromDiff,
          outOfRadius: rec.outOfRadius,
        },
        costUsdSoFar: budget.globalSpent(),
      });
      if (rec.confabulation) {
        outcome.confabulations += 1;
        trace.append("confabulation_flag", {
          nodeId: node.id,
          rung: rung.rung,
          payload: { finalMessage: record.finalMessage.slice(0, 500) },
          costUsdSoFar: budget.globalSpent(),
        });
      }

      const gate = await runGate(node.done_check, workdir, gateTimeoutMs);
      outcome.gateExitCode = gate.exitCode;
      trace.append("gate", {
        nodeId: node.id,
        rung: rung.rung,
        payload: {
          command: gate.command,
          exitCode: gate.exitCode,
          passed: gate.passed,
          timedOut: gate.timedOut,
          stdoutTail: gate.stdoutTail,
          stderrTail: gate.stderrTail,
        },
        costUsdSoFar: budget.globalSpent(),
      });

      const nodeBudgetHit = consumed.nodeBudgetExceeded;
      const nodePass =
        gate.passed && rec.violations.length === 0 && !record.errored && !nodeBudgetHit;

      if (nodePass) {
        const sha = await commitNode(workdir, node.id);
        lastGreen = sha;
        committed.add(node.id);
        outcome.passed = true;
        trace.append("checkpoint", {
          nodeId: node.id,
          rung: rung.rung,
          payload: { sha },
          costUsdSoFar: budget.globalSpent(),
        });
        trace.append("node_pass", {
          nodeId: node.id,
          rung: rung.rung,
          costUsdSoFar: budget.globalSpent(),
        });
        log(`node(${node.id}): pass (rung ${rung.rung})`);
        break;
      }

      // Failure: capture facts for the next rung's FAILURE CONTEXT, then fail.
      priorDiff = await diffSince(workdir, lastGreen);
      failure = {
        gateCommand: gate.command,
        exitCode: gate.exitCode,
        timedOut: gate.timedOut,
        stderrTail: gate.stderrTail,
        reconcileViolations: rec.violations,
        confabulation: rec.confabulation,
        changedFiles: changed,
      };
      trace.append("node_fail", {
        nodeId: node.id,
        rung: rung.rung,
        payload: { gateExitCode: gate.exitCode, reason: nodeBudgetHit ? "node_budget" : "gate_or_reconcile" },
        costUsdSoFar: budget.globalSpent(),
      });
      log(`node(${node.id}): fail (rung ${rung.rung}, gate exit ${gate.exitCode})`);

      const isLastRung = rung.rung === rungs[rungs.length - 1]!.rung;
      if (nodeBudgetHit && isLastRung) {
        // node cap on the last rung — nothing left to escalate to.
        break;
      }
      if (!isLastRung) {
        trace.append("escalate", {
          nodeId: node.id,
          rung: rung.rung,
          payload: { fromRung: rung.rung, toRung: rung.rung + 1, nextModel: rungs[rung.rung]!.model },
          costUsdSoFar: budget.globalSpent(),
        });
      }
    }

    if (!outcome.passed && !halted) {
      halted = true;
      haltReason = `node "${node.id}" exhausted the escalation ladder`;
    }
  }

  // Leave the repo at the last green checkpoint for a consistent end state.
  await resetTo(workdir, lastGreen);

  const completed = committed.size === mission.nodes.length;
  trace.append("mission_end", {
    payload: {
      completed,
      halted,
      haltReason,
      committed: [...committed],
      nodeCount: mission.nodes.length,
    },
    costUsdSoFar: budget.globalSpent(),
  });

  return {
    missionId,
    completed,
    halted,
    haltReason,
    nodes: outcomes,
    committedNodeIds: [...committed],
    totalCostUsd: budget.globalSpent(),
    tracePath,
  };
}

interface ConsumeResult {
  record: AttemptRecord;
  globalBudgetExceeded: boolean;
  nodeBudgetExceeded: boolean;
}

/**
 * Drain one attempt's EngineEvent stream into an AttemptRecord, charging the
 * budget on every usage event and tracing tool activity. Executed writes are
 * reconstructed from (tool_call write/edit) + (ok tool_result), keeping the
 * runner engine-agnostic.
 */
async function consumeAttempt(
  stream: AsyncIterable<import("../engine/types.js").EngineEvent>,
  ctx: {
    trace: Trace;
    node: MissionNode;
    rungModel: string;
    rungNumber: number;
    budget: BudgetMeter;
  },
): Promise<ConsumeResult> {
  const { trace, node, rungModel, rungNumber, budget } = ctx;
  const pending = new Map<string, ToolCallRecord>();
  const toolCalls: ToolCallRecord[] = [];
  const denied = new Set<string>();
  let blastDeniedCount = 0;
  let inTokens = 0;
  let outTokens = 0;
  let finalMessage = "";
  let errored = false;
  let errorMessage: string | undefined;
  let globalBudgetExceeded = false;
  let nodeBudgetExceeded = false;

  for await (const ev of stream) {
    switch (ev.kind) {
      case "text":
        finalMessage = ev.text;
        break;
      case "tool_call": {
        const rec: ToolCallRecord = {
          id: ev.id,
          name: ev.name,
          args: ev.args,
          ok: false,
          output: "",
          denied: false,
          path: readArg(ev.args, "path"),
          command: ev.name === "bash" ? readArg(ev.args, "command") : undefined,
        };
        pending.set(ev.id, rec);
        toolCalls.push(rec);
        trace.append("tool_call", {
          nodeId: node.id,
          rung: rungNumber,
          payload: { id: ev.id, name: ev.name, path: rec.path, command: rec.command },
          costUsdSoFar: budget.globalSpent(),
        });
        break;
      }
      case "blast_denied": {
        denied.add(ev.id);
        blastDeniedCount += 1;
        const rec = pending.get(ev.id);
        if (rec) rec.denied = true;
        trace.append("blast_denied", {
          nodeId: node.id,
          rung: rungNumber,
          payload: { id: ev.id, name: ev.name, path: ev.path, reason: ev.reason },
          costUsdSoFar: budget.globalSpent(),
        });
        break;
      }
      case "tool_result": {
        const rec = pending.get(ev.id);
        if (rec) {
          rec.ok = ev.ok;
          rec.output = ev.output;
          rec.denied = rec.denied || denied.has(ev.id);
        }
        trace.append("tool_result", {
          nodeId: node.id,
          rung: rungNumber,
          payload: { id: ev.id, ok: ev.ok, outputTail: tail(ev.output) },
          costUsdSoFar: budget.globalSpent(),
        });
        break;
      }
      case "usage": {
        inTokens += ev.inTokens;
        outTokens += ev.outTokens;
        const charge = budget.charge(rungModel, ev.inTokens, ev.outTokens);
        trace.append("usage", {
          nodeId: node.id,
          rung: rungNumber,
          payload: {
            model: rungModel,
            inTokens: ev.inTokens,
            outTokens: ev.outTokens,
            costUsd: charge.costUsd,
            nodeUsd: charge.nodeUsd,
            globalUsd: charge.globalUsd,
            unpriced: charge.unpricedModel,
          },
          costUsdSoFar: charge.globalUsd,
        });
        if (charge.nodeExceeded) nodeBudgetExceeded = true;
        if (charge.globalExceeded) {
          globalBudgetExceeded = true;
          // Hard stop: stop consuming further events immediately.
          return finalize();
        }
        break;
      }
      case "done":
        finalMessage = ev.finalMessage || finalMessage;
        break;
      case "error":
        errored = true;
        errorMessage = ev.message;
        finalMessage = finalMessage || ev.message;
        break;
    }
  }

  return finalize();

  function finalize(): ConsumeResult {
    const executedWrites = toolCalls
      .filter((tc) => (tc.name === "write" || tc.name === "edit") && tc.ok && !tc.denied && tc.path)
      .map((tc) => tc.path!);
    const record: AttemptRecord = {
      toolCalls,
      executedWrites: [...new Set(executedWrites)],
      blastDeniedCount,
      inTokens,
      outTokens,
      finalMessage,
      errored,
      errorMessage,
    };
    return { record, globalBudgetExceeded, nodeBudgetExceeded };
  }
}

function readArg(args: unknown, key: string): string | undefined {
  if (typeof args === "object" && args !== null && key in args) {
    const v = (args as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function tail(s: string, n = 600): string {
  return s.length <= n ? s : "…" + s.slice(s.length - n);
}

// Re-export for callers that build tool policies.
export type { ToolName };
