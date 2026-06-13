import { readFileSync, writeFileSync } from "node:fs";
import { stringify as yamlStringify } from "yaml";
import { z } from "zod";
import type { LlmClient } from "../llm/types.js";
import { parseSpec, type Spec } from "./spec.js";
import { DeltaSchema, normalizeDeltas, applyDeltasLenient, type Delta } from "./spec-session.js";
import { scoreSpec, READY_THRESHOLD, type SpecScore, type Improvement } from "./spec-score.js";
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
- resolve blocking questions.
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
  reachedReady: boolean;
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
  const checked = GenSchema.safeParse(parsed.value);
  if (checked.success) return checked.data.deltas;
  // salvage individually-valid deltas
  const raw = (parsed.value as { deltas?: unknown })?.deltas;
  const out: Delta[] = [];
  if (Array.isArray(raw)) for (const d of raw) {
    const ok = DeltaSchema.safeParse(d);
    if (ok.success) out.push(ok.data);
  }
  return out;
}

export async function autofillSpec(
  specPath: string,
  llm: LlmClient,
  model: string,
  opts?: { maxRounds?: number; threshold?: number },
): Promise<AutofillResult> {
  const maxRounds = opts?.maxRounds ?? 6;
  const threshold = opts?.threshold ?? READY_THRESHOLD;
  const applied: Delta[] = [];
  const defaults: string[] = [];
  let rounds = 0;
  let stagnant = 0;
  let score = await scoreSpec(parseSpec(readFileSync(specPath, "utf8"), specPath), { llm, model });

  while (rounds < maxRounds && !score.ready && score.score < threshold) {
    if (score.improvements.length === 0) break;
    const spec = parseSpec(readFileSync(specPath, "utf8"), specPath);
    const deltas = normalizeDeltas(spec, await generateFill(spec, score.improvements, llm, model));
    if (deltas.length === 0) break; // model could not produce a fix — stop, surface to user

    const { spec: next, applied: app } = applyDeltasLenient(spec, deltas);
    if (app.length === 0) break; // nothing landed — avoid spinning
    writeFileSync(specPath, yamlStringify(next));
    applied.push(...app);
    for (const d of app) {
      const stmt = (d.value as { statement?: unknown } | undefined)?.statement;
      if (d.section === "decisions" && typeof stmt === "string" && /^ser default:/i.test(stmt)) defaults.push(stmt);
    }

    const prev = score.score;
    score = await scoreSpec(next, { llm, model });
    rounds += 1;
    stagnant = score.score > prev ? 0 : stagnant + 1;
    if (stagnant >= 2) break; // two rounds without gain — genuinely stuck
  }

  return { rounds, finalScore: score, applied, defaults, reachedReady: score.ready };
}
