import { describe, it, expect } from "vitest";
import {
  parseMission,
  parseChains,
  resolveChain,
  topoSort,
  type MissionNode,
} from "../../src/contract/schema.js";
import { SquireError } from "../../src/errors.js";

const validMission = `
goal: "make it green"
budget_usd: 2.5
chain: cheap
workdir: "."
nodes:
  - id: a
    brief: "do a"
    blast_radius: ["src/a/**"]
    done_check: "pnpm test"
    budget_usd: 0.5
  - id: b
    brief: "do b"
    deps: [a]
    context_globs: ["src/a/**"]
    blast_radius: ["src/b/**"]
    done_check: "pnpm test b"
    budget_usd: 0.5
`;

describe("parseMission", () => {
  it("parses a valid mission and applies defaults", () => {
    const m = parseMission(validMission);
    expect(m.nodes).toHaveLength(2);
    const a = m.nodes[0]!;
    expect(a.deps).toEqual([]);
    expect(a.context_globs).toEqual([]);
    expect(a.max_context_tokens).toBe(40_000);
  });

  it("rejects an unknown dependency", () => {
    const bad = validMission.replace("deps: [a]", "deps: [ghost]");
    expect(() => parseMission(bad)).toThrow(SquireError);
    expect(() => parseMission(bad)).toThrow(/unknown node "ghost"/);
  });

  it("rejects duplicate node ids", () => {
    const bad = validMission.replace("id: b", "id: a");
    expect(() => parseMission(bad)).toThrow(/duplicate node id: a/);
  });

  it("rejects a dependency cycle", () => {
    const cyclic = `
goal: "loop"
budget_usd: 1
chain: cheap
nodes:
  - id: a
    brief: "a"
    deps: [b]
    blast_radius: ["**"]
    done_check: "true"
    budget_usd: 0.5
  - id: b
    brief: "b"
    deps: [a]
    blast_radius: ["**"]
    done_check: "true"
    budget_usd: 0.5
`;
    expect(() => parseMission(cyclic)).toThrow(/cycle/);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const bad = validMission + "\nsurprise: true\n";
    expect(() => parseMission(bad)).toThrow(SquireError);
  });
});

describe("parseChains / resolveChain", () => {
  const chainsYaml = `
chains:
  cheap:
    executor: "qwen/qwen3-coder"
    fallback: "deepseek/deepseek-chat"
    knight: "anthropic/claude-opus-4"
prices:
  "qwen/qwen3-coder": { in: 0.2, out: 0.8 }
`;

  it("parses chains + prices", () => {
    const c = parseChains(chainsYaml);
    expect(resolveChain(c, "cheap").executor).toBe("qwen/qwen3-coder");
    expect(c.prices["qwen/qwen3-coder"]).toEqual({ in: 0.2, out: 0.8 });
  });

  it("throws on an unknown chain name", () => {
    const c = parseChains(chainsYaml);
    expect(() => resolveChain(c, "nope")).toThrow(/not found/);
  });
});

describe("topoSort", () => {
  it("orders dependencies before dependents, stable otherwise", () => {
    const m = parseMission(validMission);
    const order = topoSort(m.nodes).map((n: MissionNode) => n.id);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
  });
});
