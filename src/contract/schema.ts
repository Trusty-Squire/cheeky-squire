import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { SquireError } from "../errors.js";

/**
 * zod schemas are the single source of truth for all file formats
 * (mission.yaml, chains.yaml). Parse the outside world here; typed
 * values flow everywhere downstream.
 */

const globList = z.array(z.string().min(1));

export const NodeSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, "node id must be [a-zA-Z0-9_-]"),
    brief: z.string().min(1),
    deps: z.array(z.string().min(1)).default([]),
    context_globs: globList.default([]),
    blast_radius: globList,
    done_check: z.string().min(1),
    budget_usd: z.number().positive(),
    max_context_tokens: z.number().int().positive().default(40_000),
  })
  .strict();

export type MissionNode = z.infer<typeof NodeSchema>;

export const MissionSchema = z
  .object({
    goal: z.string().min(1),
    budget_usd: z.number().positive(),
    chain: z.string().min(1),
    workdir: z.string().default("."),
    nodes: z.array(NodeSchema).min(1),
  })
  .strict()
  .superRefine((mission, ctx) => {
    const ids = new Set<string>();
    for (const node of mission.nodes) {
      if (ids.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate node id: ${node.id}`,
          path: ["nodes"],
        });
      }
      ids.add(node.id);
    }
    for (const node of mission.nodes) {
      for (const dep of node.deps) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `node "${node.id}" depends on unknown node "${dep}"`,
            path: ["nodes"],
          });
        }
        if (dep === node.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `node "${node.id}" depends on itself`,
            path: ["nodes"],
          });
        }
      }
    }
    // Reject cycles up front so the runner can trust the DAG.
    const cycle = findCycle(mission.nodes);
    if (cycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `dependency cycle: ${cycle.join(" -> ")}`,
        path: ["nodes"],
      });
    }
  });

export type Mission = z.infer<typeof MissionSchema>;

export const ChainSchema = z
  .object({
    executor: z.string().min(1),
    fallback: z.string().min(1),
    knight: z.string().min(1),
  })
  .strict();

export type Chain = z.infer<typeof ChainSchema>;

export const PriceSchema = z
  .object({ in: z.number().nonnegative(), out: z.number().nonnegative() })
  .strict();

export type Price = z.infer<typeof PriceSchema>;

export const ChainsFileSchema = z
  .object({
    chains: z.record(z.string(), ChainSchema),
    prices: z.record(z.string(), PriceSchema).default({}),
  })
  .strict();

export type ChainsFile = z.infer<typeof ChainsFileSchema>;

/** Parse + validate a mission.yaml string. Throws SquireError on failure. */
export function parseMission(yamlText: string, source = "mission.yaml"): Mission {
  return validate(MissionSchema, parseYamlSafe(yamlText, source), source);
}

/** Parse + validate a chains.yaml string. Throws SquireError on failure. */
export function parseChains(yamlText: string, source = "chains.yaml"): ChainsFile {
  return validate(ChainsFileSchema, parseYamlSafe(yamlText, source), source);
}

/** Resolve a chain by name, with a clear error if absent. */
export function resolveChain(chains: ChainsFile, name: string): Chain {
  const chain = chains.chains[name];
  if (!chain) {
    const known = Object.keys(chains.chains).join(", ") || "(none)";
    throw new SquireError(
      "UNKNOWN_CHAIN",
      `chain "${name}" not found in chains.yaml (known: ${known})`,
    );
  }
  return chain;
}

/**
 * Deterministic topological order: stable by declaration order, deps first.
 * Assumes the DAG is acyclic (enforced at schema validation).
 */
export function topoSort(nodes: MissionNode[]): MissionNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const order: MissionNode[] = [];
  const visit = (node: MissionNode): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    for (const dep of node.deps) {
      const depNode = byId.get(dep);
      if (depNode) visit(depNode);
    }
    order.push(node);
  };
  for (const node of nodes) visit(node);
  return order;
}

/** Returns a cycle path if the node graph has one, else null. */
function findCycle(nodes: MissionNode[]): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  const stack: string[] = [];

  const dfs = (id: string): string[] | null => {
    color.set(id, GRAY);
    stack.push(id);
    const node = byId.get(id);
    for (const dep of node?.deps ?? []) {
      if (!byId.has(dep)) continue;
      const c = color.get(dep);
      if (c === GRAY) {
        const from = stack.indexOf(dep);
        return [...stack.slice(from), dep];
      }
      if (c === WHITE) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    color.set(id, BLACK);
    stack.pop();
    return null;
  };

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      const cycle = dfs(node.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

function parseYamlSafe(yamlText: string, source: string): unknown {
  try {
    return parseYaml(yamlText);
  } catch (err) {
    throw new SquireError("YAML_PARSE", `failed to parse ${source}: ${(err as Error).message}`);
  }
}

function validate<S extends z.ZodTypeAny>(schema: S, value: unknown, source: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new SquireError("SCHEMA_INVALID", `invalid ${source}:\n${issues}`, result.error.issues);
  }
  return result.data;
}
