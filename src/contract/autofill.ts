import { readFileSync, writeFileSync } from "node:fs";
import { stringify as yamlStringify } from "yaml";
import { z } from "zod";
import type { LlmClient } from "../llm/types.js";
import { parseSpec, type Spec } from "./spec.js";
import { DeltaSchema, normalizeDeltas, applyDeltasLenient, coerceRawDeltas, verifyClaim, type Delta } from "./spec-session.js";
import { unverifiedLoadBearing } from "./spec.js";
import { scoreSpec, type SpecScore, type Improvement } from "./spec-score.js";
import { tryParseJson } from "./derive.js";
import { CASTELLAN_IDENTITY, GATE_LADDER_DOC, SPEC_ITEM_SHAPES } from "./self-knowledge.js";

/**
 * Autonomous spec authoring (dogfood 2026-06-13). When the user says "build it
 * anyway" on a low-scoring spec, ser stops asking and closes the gaps itself:
 * each round it diagnoses, generates deltas that fill what it can, applies, and
 * re-scores — until the spec is build-ready or it can make no more progress.
 * Genuine product forks (needsUser) are filled with a sensible DEFAULT recorded
 * as a "ser default:" decision the user can see and override; the spend
 * confirmation is the human checkpoint, not twenty questions.
 */

const GenSchema = z.object({ deltas: z.array(DeltaSchema).default([]) });

export const FILL_PROMPT = `${CASTELLAN_IDENTITY}

You are improving a spec until it is BUILDABLE — decomposed, every requirement
gated, blocking questions resolved, scope bounded. You are given the spec and
its open gaps. Emit deltas that CLOSE as many gaps as you can in ONE pass:
- split a coarse requirement into one requirement per capability. Each NEW
  requirement must already carry a real gate (tier 1 command, or tier 4
  artifact for subjective quality) — never leave it tier 0. CRUCIAL: also emit
  a remove for the ORIGINAL coarse requirement, so it is not re-flagged next
  round. (Omit ids on the new requirements; reference the original's id on the
  remove.)
- propose each gate from the ladder (tier-1 command for mechanical behaviour;
  tier-4 artifact for subjective quality, paired with tier-1 proxies).
- RESOLVE blocking questions. You are autofilling — you DECIDE, you do not ask.
  NEVER add a new blocking open_question. If something is genuinely undecided,
  make a "ser default: ..." decision instead, never a blocker.
For a gap marked NEEDS-DECISION (a genuine product fork), choose the most
sensible DEFAULT and record it as a decision whose statement begins
"ser default: " so the user sees and can override it. When asked to autofill,
never leave a fork silently unfilled.

${SPEC_ITEM_SHAPES}

${GATE_LADDER_DOC}

Output ONLY JSON: {"deltas":[ ... ]}.`;

export interface AutofillResult {
  rounds: number;
  finalScore: SpecScore;
  applied: Delta[];
  /** Human-readable "ser default: ..." notes for the forks ser defaulted. */
  defaults: string[];
  /** Claims the adversarial lenses REFUTED — real feasibility findings for the user. */
  refutedClaims: { id: string; evidence: string }[];
  reachedReady: boolean;
}

/**
 * Fact-check the load-bearing claims autofill introduced — the planning hour.
 * Runs the adversarial lenses on each unverified load-bearing claim (bounded
 * per round). A survived claim clears its gap; a refuted one is a real finding
 * (e.g. "a Pi 4 can't run local NLP") surfaced to the user, never papered over.
 */
async function verifyPendingClaims(
  specPath: string,
  llm: LlmClient,
  model: string,
  limit: number,
  refuted: { id: string; evidence: string }[],
): Promise<boolean> {
  const pending = [...new Set(unverifiedLoadBearing(parseSpec(readFileSync(specPath, "utf8"), specPath)).map((x) => x.claim))].slice(0, limit);
  let did = false;
  for (const cid of pending) {
    try {
      const vr = await verifyClaim(parseSpec(readFileSync(specPath, "utf8"), specPath), cid, llm, model);
      writeFileSync(specPath, yamlStringify(vr.spec));
      did = true;
      if (vr.verdict === "refuted") refuted.push({ id: cid, evidence: vr.evidence });
    } catch {
      // verification is best-effort; an unverifiable claim just stays a gap
    }
  }
  return did;
}

function describeGaps(gaps: Improvement[]): string {
  return gaps
    .map((g) => `${g.needsUser ? "NEEDS-DECISION " : ""}[${g.severity}/${g.dimension}] ${g.problem} -> ${g.suggestion}`)
    .join("\n");
}

async function generateFill(spec: Spec, gaps: Improvement[], llm: LlmClient, model: string): Promise<Delta[]> {
  const res = await llm.complete({
    model,
    system: FILL_PROMPT,
    user: `SPEC (yaml):\n${yamlStringify(spec)}\n\nOPEN GAPS:\n${describeGaps(gaps)}`,
    json: true,
    maxTokens: 3000,
  });
  const parsed = tryParseJson(res.text);
  if (!parsed.ok) return [];
  // Accept the model's natural op-keyed/section-batched shape, not just canonical.
  const coerced = coerceRawDeltas((parsed.value as { deltas?: unknown })?.deltas);
  const checked = GenSchema.safeParse({ deltas: coerced });
  if (checked.success) return checked.data.deltas;
  // salvage individually-valid deltas
  const out: Delta[] = [];
  for (const d of coerced) {
    const ok = DeltaSchema.safeParse(d);
    if (ok.success) out.push(ok.data);
  }
  return out;
}

export async function autofillSpec(
  specPath: string,
  llm: LlmClient,
  model: string,
  opts?: { maxRounds?: number },
): Promise<AutofillResult> {
  const maxRounds = opts?.maxRounds ?? 6;
  const applied: Delta[] = [];
  const defaults: string[] = [];
  const refutedClaims: { id: string; evidence: string }[] = [];
  let rounds = 0;
  let stagnant = 0;
  let score = await scoreSpec(parseSpec(readFileSync(specPath, "utf8"), specPath), { llm, model });

  // Loop until the spec is READY (every requirement gated, no refuted claim,
  // no blocker) — not until a polish threshold. Gate coverage is completeness.
  while (rounds < maxRounds && !score.ready) {
    if (score.improvements.length === 0) break;
    const spec = parseSpec(readFileSync(specPath, "utf8"), specPath);
    const raw = normalizeDeltas(spec, await generateFill(spec, score.improvements, llm, model));
    // Invariant: autofill DECIDES, it never adds a blocker. Force any
    // open_question the model tried to add to non-blocking (the cheap model
    // sometimes asks instead of deciding, which would peg the score forever).
    const deltas = raw.map((d) =>
      d.section === "open_questions" && d.op === "add" && d.value && typeof d.value === "object"
        ? { ...d, value: { ...(d.value as Record<string, unknown>), blocking: false } }
        : d,
    );

    let landed = 0;
    if (deltas.length > 0) {
      const { spec: next, applied: app } = applyDeltasLenient(spec, deltas);
      if (app.length > 0) {
        writeFileSync(specPath, yamlStringify(next));
        applied.push(...app);
        landed = app.length;
        for (const d of app) {
          const stmt = (d.value as { statement?: unknown } | undefined)?.statement;
          if (d.section === "decisions" && typeof stmt === "string" && /^ser default:/i.test(stmt)) defaults.push(stmt);
        }
      }
    }
    // "build it anyway" means decide-for-me: a blocking question is a
    // contradiction in autofill mode. De-block all open questions (they stay
    // as advisory notes the user can re-raise) so they can't peg the score.
    const cur = parseSpec(readFileSync(specPath, "utf8"), specPath);
    if (cur.open_questions.some((q) => q.blocking)) {
      writeFileSync(specPath, yamlStringify({ ...cur, open_questions: cur.open_questions.map((q) => ({ ...q, blocking: false })) }));
      landed += 1;
    }
    // Fact-check the load-bearing claims this spec now rests on (the planning
    // hour). This can make progress even when the fill produced nothing.
    const verified = await verifyPendingClaims(specPath, llm, model, 2, refutedClaims);
    if (landed === 0 && !verified) break; // genuinely stuck — surface to user

    const prev = score.score;
    score = await scoreSpec(parseSpec(readFileSync(specPath, "utf8"), specPath), { llm, model });
    rounds += 1;
    stagnant = score.score > prev ? 0 : stagnant + 1;
    if (stagnant >= 2) break; // two rounds without gain — genuinely stuck
  }

  return { rounds, finalScore: score, applied, defaults, refutedClaims, reachedReady: score.ready };
}
