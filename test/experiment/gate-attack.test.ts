import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseMission } from "../../src/contract/schema.js";
import { parseSpec } from "../../src/contract/spec.js";
import { attackMissionGates } from "../../src/experiment/gate-attack.js";

const ROOT = resolve(__dirname, "..", "..");

describe("poker-set fixtures (SPEC-v0.2 §9.3)", () => {
  it("all seven specs parse, with load-bearing unverified claims for the lenses", () => {
    const dir = join(ROOT, "specs", "poker-set");
    const files = readdirSync(dir).filter((f) => f.endsWith(".spec.yaml"));
    expect(files).toHaveLength(7);
    expect(files.filter((f) => f.startsWith("control-"))).toHaveLength(2);
    for (const f of files) {
      const spec = parseSpec(readFileSync(join(dir, f), "utf8"), f);
      expect(spec.decisions[0]!.claims.length, f).toBeGreaterThan(0);
      expect(spec.claims[0]!.status, f).toBe("unverified");
    }
  });
});

describe("gate-attack harness (SPEC-v0.2 §9.2, hermetic)", () => {
  it("task 01's gate survives: red on pristine fixture, diff-guard holds", async () => {
    const task = join(ROOT, "tasks", "01-fix-failing-test");
    const mission = parseMission(readFileSync(join(task, "mission.yaml"), "utf8"));
    const findings = await attackMissionGates(mission, join(task, "fixture"));
    expect(findings).toEqual([]);
  });

  it("flags a vacuous gate (passes with zero work) as a warn", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "vacuous-"));
    writeFileSync(join(fixture, "a.txt"), "x");
    const mission = parseMission(`
goal: "gamed"
budget_usd: 1
chain: cheap
nodes:
  - id: free
    brief: "do nothing"
    blast_radius: ["**"]
    done_check: "true"
    budget_usd: 0.5
`);
    const findings = await attackMissionGates(mission, fixture);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ node: "free", attack: "vacuous-pass", severity: "warn" });
  });

  it("flags a diff-guard that does not hold as a FAIL", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "badguard-"));
    writeFileSync(join(fixture, "frozen.txt"), "do not touch");
    const mission = parseMission(`
goal: "broken guard"
budget_usd: 1
chain: cheap
nodes:
  - id: guarded
    brief: "guard frozen.txt"
    blast_radius: ["**"]
    done_check: "git diff --quiet HEAD -- frozen.txt || true"
    budget_usd: 0.5
`);
    const findings = await attackMissionGates(mission, fixture);
    const fail = findings.find((f) => f.attack === "guard-tamper");
    expect(fail).toBeDefined();
    expect(fail!.severity).toBe("fail");
  });
});
