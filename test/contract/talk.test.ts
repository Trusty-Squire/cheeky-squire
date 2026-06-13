import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchAction, missionPathFor, type TalkActionContext } from "../../src/contract/talk.js";
import { DeltaBatchSchema, salvageBatch } from "../../src/contract/spec-session.js";
import type { LlmClient } from "../../src/llm/types.js";

const readySpec = `
thesis: "a fox companion for kids"
requirements:
  - id: R1
    statement: "core loop"
    acceptance: { tier: 1, gate: "node --test" }
`;

const unreadySpec = `
thesis: "a fox companion for kids"
requirements:
  - id: R1
    statement: "feels alive"
    acceptance: { tier: 0 }
open_questions:
  - { id: Q1, text: "what hardware?", blocking: true }
`;

const mission = `
goal: "fox companion"
budget_usd: 1
chain: cheap
nodes:
  - id: loop
    brief: "build the loop"
    blast_radius: ["**"]
    done_check: "node --test"
    budget_usd: 0.5
`;

/** An LlmClient that must never be reached — proves dispatch is mechanical. */
const deadLlm: LlmClient = {
  complete: () => {
    throw new Error("LLM must not be called for this action");
  },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "talk-"));
});

function ctx(specPath: string, extra?: Partial<TalkActionContext>): TalkActionContext {
  return { specPath, llm: deadLlm, executorModel: "m", chainName: "cheap", ...extra };
}

describe("the action field (mapper requests, harness executes)", () => {
  it("DeltaBatchSchema defaults action to none; salvage keeps valid actions and drops junk", () => {
    expect(DeltaBatchSchema.parse({ deltas: [] }).action).toBe("none");
    expect(salvageBatch({ action: "run", deltas: [] }).action).toBe("run");
    expect(salvageBatch({ action: "rm -rf /", deltas: [] }).action).toBe("none");
    expect(salvageBatch({ action: "verify", action_arg: "C2", deltas: [] }).action_arg).toBe("C2");
  });
});

describe("dispatchAction (mechanical, no LLM unless the action needs one)", () => {
  it("check on an unready spec reports NOT ready without any LLM call", async () => {
    const p = join(dir, "x.spec.yaml");
    writeFileSync(p, unreadySpec);
    const lines = await dispatchAction("check", "", ctx(p));
    expect(lines.join("\n")).toContain("NOT ready");
  });

  it("status prepends the spec inventory", async () => {
    const p = join(dir, "x.spec.yaml");
    writeFileSync(p, readySpec);
    const lines = await dispatchAction("status", "", ctx(p));
    expect(lines[0]).toContain("1 requirement(s)");
    expect(lines.join("\n")).toContain("READY to compile");
  });

  it("verify with nothing to verify says so without an LLM call", async () => {
    const p = join(dir, "x.spec.yaml");
    writeFileSync(p, readySpec);
    const lines = await dispatchAction("verify", "", ctx(p));
    expect(lines[0]).toContain("nothing to verify");
  });

  it("run on an unready spec refuses at the pre-gate — execute is never reached", async () => {
    const p = join(dir, "x.spec.yaml");
    writeFileSync(p, unreadySpec);
    let executed = false;
    const lines = await dispatchAction("run", "", ctx(p, {
      execute: async () => { executed = true; return 0; },
      confirm: async () => true,
    }));
    expect(executed).toBe(false);
    expect(lines.join("\n")).toContain("refused");
    expect(lines.join("\n")).toContain("UNANCHORED");
  });

  it("run with a fresh mission asks to confirm spend; unconfirmed = cancelled", async () => {
    const p = join(dir, "x.spec.yaml");
    writeFileSync(p, readySpec);
    const mp = missionPathFor(p);
    writeFileSync(mp, mission);
    const future = new Date(Date.now() + 60_000);
    utimesSync(mp, future, future); // mission newer than spec — no re-derive
    let executed = false;
    let asked = "";
    const lines = await dispatchAction("run", "", ctx(p, {
      execute: async () => { executed = true; return 0; },
      confirm: async (q) => { asked = q; return false; },
    }));
    expect(asked).toContain("budget $1");
    expect(executed).toBe(false);
    expect(lines.join("\n")).toContain("cancelled");
  });

  it("run confirmed executes the mission and reports the harness verdict", async () => {
    const p = join(dir, "x.spec.yaml");
    writeFileSync(p, readySpec);
    const mp = missionPathFor(p);
    writeFileSync(mp, mission);
    const future = new Date(Date.now() + 60_000);
    utimesSync(mp, future, future);
    const ran: string[] = [];
    const lines = await dispatchAction("run", "", ctx(p, {
      execute: async (path) => { ran.push(path); return 0; },
      confirm: async () => true,
    }));
    expect(ran).toEqual([mp]);
    expect(lines.join("\n")).toContain("every gate green");
  });

  it("run without an executor degrades politely", async () => {
    const p = join(dir, "x.spec.yaml");
    writeFileSync(p, readySpec);
    const lines = await dispatchAction("run", "", ctx(p));
    expect(lines[0]).toContain("not available");
  });
});
