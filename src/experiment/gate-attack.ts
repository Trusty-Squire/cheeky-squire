import { cpSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { effectiveGate, type Mission } from "../contract/schema.js";
import { runGate } from "../harness/gates.js";

/**
 * Gate-attack harness (SPEC-v0.2 §9.2): automated null-solution checks
 * against a mission's gates, run in a throwaway fixture copy.
 *
 * Attacks (generic, no LLM):
 *  - vacuous-pass: the gate PASSES on the pristine fixture with no work done.
 *    A node whose gate needs no work is a free commit (WARN — refactor-shaped
 *    nodes legitimately start green, but a derived plan full of these is
 *    gamed).
 *  - guard-tamper: gates carrying `git diff --quiet HEAD -- <path>` must FAIL
 *    once the guarded file is modified (FAIL if the tamper sneaks through).
 */

export interface AttackFinding {
  node: string;
  attack: "vacuous-pass" | "guard-tamper";
  severity: "warn" | "fail";
  detail: string;
}

export async function attackMissionGates(
  mission: Mission,
  fixtureDir: string,
  opts: { timeoutMs?: number } = {},
): Promise<AttackFinding[]> {
  const findings: AttackFinding[] = [];

  for (const node of mission.nodes) {
    const gate = effectiveGate(node);
    if (gate.type !== "command" && gate.type !== "metric") continue; // human/judge: nothing to attack mechanically

    // -- vacuous-pass: gate green before any work happens
    {
      const dir = mkdtempSync(join(tmpdir(), "gate-attack-"));
      try {
        cpSync(fixtureDir, dir, { recursive: true });
        await initThrowawayRepo(dir);
        const r = await runGate(gate.run!, dir, opts.timeoutMs ?? 60_000);
        if (r.passed) {
          findings.push({
            node: node.id,
            attack: "vacuous-pass",
            severity: "warn",
            detail: `gate passes on the pristine fixture — the node requires no verified work to commit`,
          });
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    // -- guard-tamper: every diff-guarded path must trip the gate when touched
    const guards = [...gate.run!.matchAll(/git diff --quiet(?: HEAD)?(?: --)? ([^&|;]+)/g)].map((m) => m[1]!.trim());
    for (const guarded of guards) {
      const dir = mkdtempSync(join(tmpdir(), "gate-attack-"));
      try {
        cpSync(fixtureDir, dir, { recursive: true });
        await initThrowawayRepo(dir);
        const target = join(dir, guarded);
        if (!existsSync(target)) continue; // file created later in the mission; can't tamper yet
        writeFileSync(target, readFileSync(target, "utf8") + "\n// tampered\n");
        const r = await runGate(gate.run!, dir, opts.timeoutMs ?? 60_000);
        if (r.passed) {
          findings.push({
            node: node.id,
            attack: "guard-tamper",
            severity: "fail",
            detail: `modified "${guarded}" and the gate still passed — the diff-guard does not hold`,
          });
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  return findings;
}

async function initThrowawayRepo(dir: string): Promise<void> {
  const { execa } = await import("execa");
  await execa("git", ["init", "-q"], { cwd: dir });
  await execa("git", ["config", "user.email", "a@b.c"], { cwd: dir });
  await execa("git", ["config", "user.name", "attack"], { cwd: dir });
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa("git", ["commit", "-q", "-m", "baseline", "--allow-empty"], { cwd: dir });
}
