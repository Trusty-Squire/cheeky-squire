import { z } from "zod";
import type { LlmClient } from "../llm/types.js";
import { tryParseJson } from "./derive.js";
import { CASTELLAN_IDENTITY, GATE_LADDER_DOC } from "./self-knowledge.js";
import {
  unanchoredRequirements,
  blockingQuestions,
  unverifiedLoadBearing,
  refutedDecisions,
  type Spec,
} from "./spec.js";

/**
 * Spec readiness score (SPEC-v0.2 §5.4, dogfood 2026-06-13). The loop drives
 * the spec toward build-readiness: every turn ser self-diagnoses gaps, emits a
 * score, and until the score is high it keeps closing them — asking the user
 * ONLY the forks it cannot resolve, proposing the rest itself.
 *
 * Honesty rule (the model never grades its own homework): the NUMBER is
 * computed mechanically from objective spec facts + fixed severity weights.
 * The LLM only DIAGNOSES — it proposes improvements and tags severity, but it
 * cannot inflate the score, because the mechanical blockers independently cap
 * readiness and the arithmetic lives in code.
 */

export type Severity = "blocking" | "major" | "minor";

export interface Improvement {
  dimension: string;
  severity: Severity;
  problem: string;
  /** A concrete proposed fix ser can apply or the user can approve. */
  suggestion: string;
  /** true = a genuine fork ser cannot decide for the user (ask it); false = ser can just propose/apply. */
  needsUser: boolean;
}

export interface SpecScore {
  score: number; // 0–100, computed in code
  ready: boolean;
  improvements: Improvement[]; // sorted worst-first
}

export const SEVERITY_WEIGHT: Record<Severity, number> = { blocking: 40, major: 15, minor: 5 };
export const READY_THRESHOLD = 85;

/** The LLM diagnostician's output shape (advice only — no score). */
const DiagnosisSchema = z.object({
  improvements: z
    .array(
      z.object({
        dimension: z.string().default("quality"),
        severity: z.enum(["blocking", "major", "minor"]).default("major"),
        problem: z.string(),
        suggestion: z.string().default(""),
        needsUser: z.boolean().default(false),
      }),
    )
    .default([]),
});

export const DIAGNOSTIC_PROMPT = `${CASTELLAN_IDENTITY}

Your job here: make this spec more BUILDABLE and VERIFIABLE. Diagnose concrete
gaps a cheap agent loop would trip on — do not rewrite it, do not praise it.
For each gap output: dimension, severity (blocking|major|minor), the problem in
one line, a SPECIFIC suggestion (the fix you'd apply), and needsUser.

needsUser=true ONLY for a genuine fork you cannot decide for the user — a real
product choice (target hardware/runtime, a subjective quality bar like what
"safe" or "believable" must mean, a scope tradeoff). needsUser=false when you
can just propose the fix yourself (splitting a coarse requirement, choosing a
gate from the ladder, naming a default).

Look hardest for: a single coarse requirement that should be several; gates
that a STUB would pass (no varied inputs / no real assertion); subjective
quality with no tier-4 artifact; missing capabilities the thesis implies;
unstated assumptions that are load-bearing.

${GATE_LADDER_DOC}

Output ONLY JSON: {"improvements":[{"dimension","severity","problem","suggestion","needsUser"}]}.`;

/** Mechanical dimensions → improvements. No LLM; objective and reproducible. */
export function mechanicalImprovements(spec: Spec): Improvement[] {
  const out: Improvement[] = [];
  for (const r of unanchoredRequirements(spec)) {
    out.push({
      dimension: "anchoring",
      severity: "blocking",
      problem: `requirement ${r} has no objective check (tier 0)`,
      suggestion: `propose a gate for ${r} from the ladder (tier-1 command, or tier-4 artifact for subjective quality)`,
      needsUser: false,
    });
  }
  for (const d of refutedDecisions(spec)) {
    out.push({
      dimension: "feasibility",
      severity: "blocking",
      problem: `decision ${d} rests on a refuted claim`,
      suggestion: `revise ${d} or replace the refuted claim`,
      needsUser: true,
    });
  }
  for (const q of blockingQuestions(spec)) {
    out.push({
      dimension: "decided",
      severity: "major",
      problem: `open question ${q} is blocking`,
      suggestion: `resolve ${q} — propose an answer or ask the user if it is a real fork`,
      needsUser: false,
    });
  }
  for (const { decision, claim } of unverifiedLoadBearing(spec)) {
    out.push({
      dimension: "claims",
      severity: "major",
      problem: `decision ${decision} rests on unverified claim ${claim}`,
      suggestion: `verify ${claim} (ser runs the adversarial lenses)`,
      needsUser: false,
    });
  }
  if (spec.requirements.length < 2) {
    out.push({
      dimension: "decomposition",
      severity: "major",
      problem: "the whole product is one requirement — too coarse to gate meaningfully",
      suggestion: "split it into one requirement per capability, each with its own gate",
      needsUser: false,
    });
  }
  if (spec.scope_fence.length === 0) {
    out.push({
      dimension: "scope",
      severity: "minor",
      problem: "no scope fence — nothing says what this is NOT",
      suggestion: "add 2-3 scope_fence lines bounding the build",
      needsUser: false,
    });
  }
  return out;
}

const SEV_RANK: Record<Severity, number> = { blocking: 0, major: 1, minor: 2 };

/** Merge mechanical + model improvements (dedup by dimension+problem), worst-first. */
function mergeImprovements(mech: Improvement[], model: Improvement[]): Improvement[] {
  const seen = new Set(mech.map((i) => `${i.dimension}:${i.problem.toLowerCase()}`));
  const all = [...mech];
  for (const m of model) {
    const key = `${m.dimension}:${m.problem.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(m);
    }
  }
  return all.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}

/** Compute the score from the improvement list. Code owns the arithmetic. */
export function scoreFromImprovements(improvements: Improvement[]): SpecScore {
  const penalty = improvements.reduce((sum, i) => sum + SEVERITY_WEIGHT[i.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const hasBlocking = improvements.some((i) => i.severity === "blocking");
  return { score, ready: score >= READY_THRESHOLD && !hasBlocking, improvements };
}

/**
 * Score a spec. With an llm, runs the diagnostician for the judgment gaps
 * (coarse requirements, stub-passable gates, missing capabilities) and merges
 * them with the mechanical floor. Without one, returns the mechanical score
 * (fully offline/testable). `modelImprovements` lets a talk turn pass a
 * diagnosis it already obtained instead of paying for a second call.
 */
export async function scoreSpec(
  spec: Spec,
  opts?: { llm?: LlmClient; model?: string; modelImprovements?: Improvement[] },
): Promise<SpecScore> {
  const mech = mechanicalImprovements(spec);
  let model: Improvement[] = opts?.modelImprovements ?? [];
  if (!opts?.modelImprovements && opts?.llm && opts.model) {
    try {
      const res = await opts.llm.complete({
        model: opts.model,
        system: DIAGNOSTIC_PROMPT,
        user: `SPEC (yaml):\n${(await import("yaml")).stringify(spec)}`,
        json: true,
        maxTokens: 1500,
      });
      const parsed = tryParseJson(res.text);
      if (parsed.ok) {
        const checked = DiagnosisSchema.safeParse(parsed.value);
        if (checked.success) model = checked.data.improvements;
      }
    } catch {
      // diagnosis is best-effort; the mechanical floor always stands
    }
  }
  return scoreFromImprovements(mergeImprovements(mech, model));
}

/** One-line bar + the single next decision to surface, for the talk loop. */
export function renderScoreLine(s: SpecScore): string {
  if (s.ready || s.improvements.length === 0) {
    return `spec score: ${s.score}/100${s.ready ? " — READY to build" : ""}`;
  }
  // At low scores many blocking gaps all floor to 0, hiding progress — show the
  // gap count so the loop's movement (gaps closing) is visible turn to turn.
  const blocking = s.improvements.filter((i) => i.severity === "blocking").length;
  const tally = `${s.improvements.length} gap(s)${blocking ? `, ${blocking} blocking` : ""}`;
  const top = s.improvements[0]!;
  const lead = top.needsUser ? "decision" : "suggestion";
  return `spec score: ${s.score}/100 (${tally})\n  next ${lead} [${top.severity}/${top.dimension}]: ${top.problem}\n    → ${top.suggestion}`;
}
