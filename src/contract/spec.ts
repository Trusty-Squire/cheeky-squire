import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { SquireError } from "../errors.js";

/**
 * Spec-under-construction (SPEC-v0.2 §5.1). The artifact IS the state of
 * phase-1 thinking: the transcript that produced it is disposable. zod is the
 * single source of truth; prose lives in string fields. File: <name>.spec.yaml.
 */

export const AcceptanceSchema = z
  .object({
    /** 0 = UNANCHORED (blocks compile); 1 command; 2 metric; 3 judge(soft); 4 human. */
    tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    /** tier 1-3: the check command (or judge rubric ref). */
    gate: z.string().min(1).optional(),
    /** tier 4: the adjudication artifact. */
    artifact: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const need = (cond: boolean, message: string) => {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    };
    if (a.tier >= 1 && a.tier <= 3) need(Boolean(a.gate), `tier-${a.tier} acceptance requires "gate"`);
    if (a.tier === 4) need(Boolean(a.artifact), 'tier-4 acceptance requires "artifact"');
    if (a.tier === 0) need(!a.gate && !a.artifact, "tier-0 (unanchored) must not carry gate/artifact");
  });

const idOf = (prefix: string) => z.string().regex(new RegExp(`^${prefix}\\d+$`), `id must be ${prefix}<n>`);

export const SpecSchema = z
  .object({
    thesis: z.string().min(1),
    /** The key user stories the build serves — the unit of "minimum viable". */
    stories: z.array(z.string().min(1)).default([]),
    scope_fence: z.array(z.string().min(1)).default([]),
    requirements: z
      .array(
        z
          .object({
            id: idOf("R"),
            statement: z.string().min(1),
            acceptance: AcceptanceSchema,
          })
          .strict(),
      )
      .min(1),
    decisions: z
      .array(
        z
          .object({
            id: idOf("D"),
            statement: z.string().min(1),
            rationale: z.string().min(1),
            claims: z.array(idOf("C")).default([]),
          })
          .strict(),
      )
      .default([]),
    claims: z
      .array(
        z
          .object({
            id: idOf("C"),
            statement: z.string().min(1),
            status: z.enum(["unverified", "verified", "refuted"]).default("unverified"),
            /** Source URL or shown arithmetic; REQUIRED for verified/refuted. */
            evidence: z.string().default(""),
          })
          .strict(),
      )
      .default([]),
    open_questions: z
      .array(
        z
          .object({
            id: idOf("Q"),
            text: z.string().min(1),
            blocking: z.boolean().default(false),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const claimIds = new Set(spec.claims.map((c) => c.id));
    for (const d of spec.decisions) {
      for (const ref of d.claims) {
        if (!claimIds.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `decision "${d.id}" references unknown claim "${ref}"`,
            path: ["decisions"],
          });
        }
      }
    }
    for (const c of spec.claims) {
      if (c.status !== "unverified" && c.evidence.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `claim "${c.id}" is ${c.status} but carries no evidence (source URL or shown arithmetic)`,
          path: ["claims"],
        });
      }
    }
    for (const section of ["requirements", "decisions", "claims", "open_questions"] as const) {
      const seen = new Set<string>();
      for (const item of spec[section]) {
        if (seen.has(item.id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate id "${item.id}"`, path: [section] });
        }
        seen.add(item.id);
      }
    }
  });

export type Spec = z.infer<typeof SpecSchema>;

export function parseSpec(yamlText: string, source = "spec.yaml"): Spec {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new SquireError("YAML_PARSE", `failed to parse ${source}: ${(err as Error).message}`);
  }
  const result = SpecSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new SquireError("SPEC_INVALID", `invalid ${source}:\n${issues}`, result.error.issues);
  }
  return result.data;
}

// --- Spec-gate helpers (consumed by `ser spec check` and derive --judge) ---

/** Requirements with tier-0 (unanchored) acceptance — these block compilation. */
export function unanchoredRequirements(spec: Spec): string[] {
  return spec.requirements.filter((r) => r.acceptance.tier === 0).map((r) => r.id);
}

/** Claims referenced by any decision that are not yet verified (load-bearing + unproven). */
export function unverifiedLoadBearing(spec: Spec): { decision: string; claim: string }[] {
  const status = new Map(spec.claims.map((c) => [c.id, c.status]));
  const out: { decision: string; claim: string }[] = [];
  for (const d of spec.decisions) {
    for (const ref of d.claims) {
      if (status.get(ref) !== "verified") out.push({ decision: d.id, claim: ref });
    }
  }
  return out;
}

/** Decisions resting on at least one REFUTED claim — must be revised before compile. */
export function refutedDecisions(spec: Spec): string[] {
  const refuted = new Set(spec.claims.filter((c) => c.status === "refuted").map((c) => c.id));
  return spec.decisions.filter((d) => d.claims.some((c) => refuted.has(c))).map((d) => d.id);
}

/** Blocking open questions. */
export function blockingQuestions(spec: Spec): string[] {
  return spec.open_questions.filter((q) => q.blocking).map((q) => q.id);
}
