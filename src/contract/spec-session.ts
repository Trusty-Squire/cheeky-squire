import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, basename } from "node:path";
import { execa } from "execa";
import { stringify as yamlStringify } from "yaml";
import { SquireError } from "../errors.js";
import type { LlmClient } from "../llm/types.js";
import { parseSpec, SpecSchema, unverifiedLoadBearing, type Spec } from "./spec.js";
import { specPreGate } from "./derive2.js";
import { tryParseJson, formatZodIssues } from "./derive.js";
import { CASTELLAN_IDENTITY, GATE_LADDER_DOC, SPEC_ITEM_SHAPES } from "./self-knowledge.js";

/**
 * ser spec — gated spec construction (SPEC-v0.2 §5). The spec file is the
 * ONLY state; the conversation is disposable. Each turn: user message in,
 * proposed DELTAS out (≤1 question, ≤120 words of prose). Accepted deltas
 * apply, validate, save, and git-commit (checkpointed thinking).
 */

export const DeltaSchema = z
  .object({
    section: z.enum(["thesis", "scope_fence", "requirements", "decisions", "claims", "open_questions"]),
    op: z.enum(["add", "modify", "remove", "resolve"]),
    /** Target id for modify/remove/resolve on list sections. */
    id: z.string().optional(),
    /** New value: full item object for add/modify; string for thesis/scope_fence add. */
    value: z.unknown().optional(),
    /** Set by the proposer when this delta contradicts the pinned thesis. */
    drift: z.boolean().default(false),
  })
  .strict();

export type Delta = z.infer<typeof DeltaSchema>;

/** Harness commands the mapper may REQUEST (never perform): the unified
 * interface routes these mechanically — gates judge, the model never reports. */
export const TALK_ACTIONS = ["none", "check", "verify", "derive", "run", "status", "score"] as const;

export const DeltaBatchSchema = z.object({
  deltas: z.array(DeltaSchema),
  /** At most one terse question — the highest-information open one. */
  question: z.string().default(""),
  /** The conversational answer: substantive, brutally economical (<=80 words). */
  reply: z.string().default(""),
  /** Deprecated alias kept for compat. */
  note: z.string().default(""),
  /** Requested harness command; the harness executes and reports, not the model. */
  action: z.enum(TALK_ACTIONS).default("none"),
  /** Action argument (e.g. claim id for verify). */
  action_arg: z.string().default(""),
});

export type DeltaBatch = z.infer<typeof DeltaBatchSchema>;

/** Appendix A (SPEC-v0.2) — delta-mapper instruction, draft. */
export const DELTA_MAPPER_PROMPT = `${CASTELLAN_IDENTITY}

Your role: a thought partner who is brutally economical with words, plus a
silent bookkeeper. The spec below is the ONLY state; this conversation is
disposable.

You have NO tools and cannot build, run, edit, or test anything yourself —
but you can ask the HARNESS to act by setting "action" in your output:
  check  — mechanical spec gates: is it ready to compile?
  verify — adversarial lenses on one ledger claim (action_arg: the claim id)
  derive — compile the spec into a gated mission plan
  run    — execute the mission, gate-verified commits (the harness derives
           first when the plan is stale and asks the user to confirm spend;
           it REFUSES if the spec readiness score is too low)
  status — spec summary + gates
  score  — readiness score + the next gap to close (auto-shown each turn)
Set an action ONLY when the user asks for that work ("build it" -> run;
"is this ready?" -> check; "fact-check C2" -> verify). The harness executes
and prints the results — gate verdicts, commits, costs. You NEVER claim work
was performed and never report results yourself; keep the reply to intent
("running it — gates will report"). Never resolve or remove a requirement
because it is "built" — only its gate, at run time, can prove that.

For each user message output JSON:
{"reply": "...", "deltas": [...], "question": ""}

reply — actually engage: answer their question, reason, push back, propose.
Hard cap 80 words. No preamble, no praise, no restating, no filler. If they
ask how to build it, sketch the build in <=80 words. Your reply must MATCH
the deltas you emit — never claim you recorded something you did not put in
deltas; the harness prints the receipts and a mismatch is a visible lie.

deltas — IN THE BACKGROUND, record everything decided, claimed, required, or
asked as spec deltas (add/modify/resolve/remove by section and id). Nothing
the user said may change the spec without a delta. Never a no-op delta. If
the message pivots to a DIFFERENT product, include a thesis modify delta
with drift:true — never bury a pivot in scope_fence. EXCEPTION: while the
thesis is still a TODO placeholder this is a NEW spec — the first real idea
SETS it (thesis modify, drift:false), and TODO placeholders (thesis, R1)
are REPLACED with real content, never kept alongside additions.

CRITICAL — capture what the user states, never make them repeat it:
- thesis modify value is ALWAYS a plain string, never an object.
- When the user says WHAT to build ("an ai companion for my daughter"),
  that IS the first requirement: emit {section:requirements, op:modify,
  id:"R1", value:{id:"R1","statement":"<their words>","acceptance":{tier:0}}}
  to fill the R1 placeholder. Then propose its gate (below). Do NOT ask
  them to restate the goal — if they already said it, record it.

PROPOSE gates; never interrogate. You own the gate ladder — the user does
not. When a requirement has tier-0 (no check), CHOOSE the check yourself and
put it in acceptance:
- mechanical/behavioral -> tier 1 {"tier":1,"gate":"<shell cmd>"}.
- subjective quality ("safe", "feels alive", "child-appropriate") -> tier 4
  {"tier":4,"artifact":"<path a human reviews in <1 min>"}, paired with
  tier-1 proxies for the mechanical parts as separate requirements.
Resolve the blocking Q1 ("first requirement's objective check") in the SAME
batch you set R1's acceptance. NEVER ask the user "what should the check be?"
— propose it. NEVER ask the same question twice; if the user pushes back
("i just told you"), they are right — record their last message and advance.

question — at most ONE, only when it is a genuine FORK you cannot resolve
yourself (never a gate you should propose, never a goal already stated).
Usually empty.

${SPEC_ITEM_SHAPES}

${GATE_LADDER_DOC}

Detailed test design happens later at derive; acceptance needs the right
TIER plus a real command or artifact.`;

/** Pure: apply a delta batch to a spec, re-validating the result. */
export function applyDeltas(spec: Spec, deltas: Delta[]): Spec {
  const draft: Record<string, unknown> = JSON.parse(JSON.stringify(spec));
  for (const d of deltas) {
    if (d.section === "thesis") {
      if (d.op !== "modify" || typeof d.value !== "string") {
        throw new SquireError("DELTA_INVALID", "thesis only supports modify with a string value");
      }
      draft.thesis = d.value;
      continue;
    }
    if (d.section === "scope_fence") {
      const fence = draft.scope_fence as string[];
      if (d.op === "add" && typeof d.value === "string") fence.push(d.value);
      else if (d.op === "remove" && typeof d.value === "string") {
        draft.scope_fence = fence.filter((f) => f !== d.value);
      } else throw new SquireError("DELTA_INVALID", "scope_fence supports add/remove with a string value");
      continue;
    }
    const list = draft[d.section] as { id: string }[];
    switch (d.op) {
      case "add":
        list.push(d.value as { id: string });
        break;
      case "modify": {
        const i = list.findIndex((x) => x.id === d.id);
        if (i === -1) throw new SquireError("DELTA_INVALID", `${d.section}/${d.id} not found for modify`);
        list[i] = { ...list[i], ...(d.value as object), id: d.id! };
        break;
      }
      case "remove":
      case "resolve": {
        const i = list.findIndex((x) => x.id === d.id);
        if (i === -1) throw new SquireError("DELTA_INVALID", `${d.section}/${d.id} not found for ${d.op}`);
        if (d.op === "resolve" && d.section === "open_questions") list.splice(i, 1);
        else if (d.op === "remove") list.splice(i, 1);
        else throw new SquireError("DELTA_INVALID", "resolve only applies to open_questions");
        break;
      }
    }
  }
  const checked = SpecSchema.safeParse(draft);
  if (!checked.success) {
    throw new SquireError(
      "DELTA_INVALID",
      `applying deltas would invalidate the spec:\n${formatZodIssues(checked.error.issues)}`,
    );
  }
  return checked.data;
}

/** Keep the conversation, salvage individually-valid deltas, drop the rest. */
export function salvageBatch(raw: unknown): DeltaBatch {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const deltas: Delta[] = [];
  if (Array.isArray(o.deltas)) {
    for (const d of o.deltas) {
      const ok = DeltaSchema.safeParse(d);
      if (ok.success) deltas.push(ok.data);
    }
  }
  const action = (TALK_ACTIONS as readonly string[]).includes(o.action as string)
    ? (o.action as DeltaBatch["action"])
    : "none";
  return {
    deltas,
    question: typeof o.question === "string" ? o.question : "",
    reply: typeof o.reply === "string" ? o.reply : "",
    note: "",
    action,
    action_arg: typeof o.action_arg === "string" ? o.action_arg : "",
  };
}

/**
 * Apply deltas one at a time, skipping any that would invalidate the spec —
 * the bookkeeper must never lose the whole batch (or the conversation) to one
 * bad edit. Returns what applied and why the rest dropped.
 */
export function applyDeltasLenient(
  spec: Spec,
  deltas: Delta[],
): { spec: Spec; applied: Delta[]; dropped: { delta: Delta; reason: string }[] } {
  let current = spec;
  const applied: Delta[] = [];
  const dropped: { delta: Delta; reason: string }[] = [];
  for (const d of deltas) {
    try {
      current = applyDeltas(current, [d]);
      applied.push(d);
    } catch (err) {
      dropped.push({ delta: d, reason: (err as Error).message.split("\n").slice(0, 2).join(" ") });
    }
  }
  return { spec: current, applied, dropped };
}

/** Mechanical drift check: flag deltas the proposer didn't self-flag. */
export function markDrift(batch: DeltaBatch): DeltaBatch {
  return batch; // proposer-flagged only in v0.2; mechanical NLI check is v0.3 (A26)
}

const LIST_PREFIX: Record<string, string> = {
  requirements: "R",
  decisions: "D",
  claims: "C",
  open_questions: "Q",
};

function isPlaceholderReq(r: unknown): boolean {
  const o = r as { statement?: unknown };
  return typeof o?.statement === "string" && /^TODO\b/i.test(o.statement);
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["value", "statement", "thesis", "text"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
  }
  return null;
}

function nextId(prefix: string, list: { id: string }[]): string {
  let max = 0;
  for (const x of list) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(x.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/**
 * Repair the cheap model's near-miss deltas so the user's words actually land
 * (dogfood: a `modify` with no id, or a thesis modify carrying an object,
 * silently dropped the user's stated goal and the bookkeeper then asked them
 * to repeat it). Conservative — it only fixes mechanical id/shape mistakes,
 * never invents content:
 *  - thesis modify with a non-string value -> the extracted string.
 *  - list modify whose id is missing/unknown -> the id carried in value, or
 *    the TODO placeholder for requirements, else converted to an add.
 *  - requirement add/fill with no acceptance -> tier 0 (unanchored) so the
 *    statement is captured now and gated next.
 */
export function normalizeDeltas(spec: Spec, deltas: Delta[]): Delta[] {
  const out: Delta[] = [];
  const reqs = spec.requirements as { id: string; statement: string }[];
  let placeholderId: string | undefined = reqs.find(isPlaceholderReq)?.id;

  const withAcceptance = (val: Record<string, unknown>, id: string): Record<string, unknown> => {
    const v: Record<string, unknown> = { ...val, id };
    if (v.acceptance === undefined) v.acceptance = { tier: 0 };
    return v;
  };

  for (const d of deltas) {
    if (d.section === "thesis") {
      if (d.op === "modify") {
        const s = asString(d.value);
        out.push(s !== null ? { ...d, value: s } : d);
      } else out.push(d);
      continue;
    }

    const list = (spec as unknown as Record<string, { id: string }[]>)[d.section] ?? [];
    const ids = new Set(list.map((x) => x.id));
    const val = d.value && typeof d.value === "object" ? (d.value as Record<string, unknown>) : undefined;
    const valId = typeof val?.id === "string" ? (val.id as string) : undefined;

    if (d.op === "modify") {
      const targetId = d.id && ids.has(d.id) ? d.id : valId && ids.has(valId) ? valId : undefined;
      if (targetId) {
        out.push({ ...d, id: targetId, value: val ? { ...val, id: targetId } : d.value });
        continue;
      }
      // No resolvable target. For requirements, fill the TODO placeholder.
      if (d.section === "requirements" && placeholderId) {
        out.push({ ...d, op: "modify", id: placeholderId, value: withAcceptance(val ?? {}, placeholderId) });
        placeholderId = undefined;
        continue;
      }
      // Otherwise upsert: convert to an add with a real id (value-supplied or next).
      const id = valId ?? nextId(LIST_PREFIX[d.section]!, list);
      const value = d.section === "requirements" ? withAcceptance(val ?? {}, id) : { ...(val ?? {}), id };
      out.push({ ...d, op: "add", id: undefined, value });
      continue;
    }

    // An add of a real requirement while the placeholder still exists fills it
    // (so we never keep a TODO R1 beside the real one).
    if (d.op === "add" && d.section === "requirements" && placeholderId && !isPlaceholderReq(val)) {
      out.push({ ...d, op: "modify", id: placeholderId, value: withAcceptance(val ?? {}, placeholderId) });
      placeholderId = undefined;
      continue;
    }

    out.push(d);
  }
  return out;
}

export interface SpecSessionOptions {
  path: string;
  llm: LlmClient;
  executorModel: string;
  knightModel: string;
  /** Consecutive rejected batches before generative turns escalate (SPEC-v0.2 §5.2). */
  escalateAfter?: number;
  git?: boolean;
}

export class SpecSession {
  readonly path: string;
  private readonly opts: SpecSessionOptions;
  private consecutiveRejections = 0;
  private usage = { in: 0, out: 0 };

  constructor(opts: SpecSessionOptions) {
    this.opts = opts;
    this.path = opts.path;
    if (!existsSync(opts.path)) {
      throw new SquireError("SPEC_NOT_FOUND", `spec not found: ${opts.path} (ser spec init first)`);
    }
  }

  /** State lives in the artifact: every read comes from disk (resume = free). */
  load(): Spec {
    return parseSpec(readFileSync(this.path, "utf8"), this.path);
  }

  /** The model for the next generative turn — escalates on demonstrated failure. */
  currentModel(): string {
    return this.consecutiveRejections >= (this.opts.escalateAfter ?? 2)
      ? this.opts.knightModel
      : this.opts.executorModel;
  }

  /** One turn: user message → proposed delta batch (NOT yet applied). */
  async turn(userMessage: string): Promise<DeltaBatch> {
    const spec = this.load();
    const model = this.currentModel();
    let note = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.opts.llm.complete({
        model,
        system: DELTA_MAPPER_PROMPT,
        user: `CURRENT SPEC (yaml):\n${yamlStringify(spec)}\n\nUSER MESSAGE:\n${userMessage}${note}`,
        json: true,
        maxTokens: 2000,
      });
      this.usage.in += res.inTokens;
      this.usage.out += res.outTokens;
      const parsed = tryParseJson(res.text);
      if (parsed.ok) {
        const checked = DeltaBatchSchema.safeParse(parsed.value);
        if (checked.success) {
          const b = markDrift(checked.data);
          return { ...b, deltas: normalizeDeltas(spec, b.deltas) };
        }
        if (attempt === 1) {
          const b = salvageBatch(parsed.value); // degrade, never crash
          return { ...b, deltas: normalizeDeltas(spec, b.deltas) };
        }
        note = `\n\nYour previous output failed validation:\n${formatZodIssues(checked.error.issues)}`;
      } else {
        if (attempt === 1) {
          // Bookkeeping failed twice; keep the conversation alive with raw text.
          return { deltas: [], question: "", note: "", reply: res.text.slice(0, 400), action: "none" as const, action_arg: "" };
        }
        note = `\n\nYour previous output was not valid JSON: ${parsed.error}`;
      }
    }
    throw new SquireError("SPEC_TURN_INVALID", "unreachable");
  }

  /** Accept a batch: apply, save, git-commit. Resets the rejection counter. */
  async accept(batch: DeltaBatch): Promise<Spec> {
    const next = applyDeltas(this.load(), batch.deltas);
    writeFileSync(this.path, yamlStringify(next));
    this.consecutiveRejections = 0;
    if (this.opts.git !== false) {
      const dir = dirname(this.path);
      await execa("git", ["add", basename(this.path)], { cwd: dir, reject: false });
      await execa(
        "git",
        ["commit", "-q", "-m", `spec(${basename(this.path)}): ${batch.deltas.length} delta(s)`],
        { cwd: dir, reject: false },
      );
    }
    return next;
  }

  /** Lenient accept: apply what validates, report what dropped. Saves + commits when anything applied. */
  async acceptLenient(batch: DeltaBatch): Promise<{ applied: Delta[]; dropped: { delta: Delta; reason: string }[] }> {
    const { spec, applied, dropped } = applyDeltasLenient(this.load(), batch.deltas);
    if (applied.length > 0) {
      writeFileSync(this.path, yamlStringify(spec));
      this.consecutiveRejections = 0;
      if (this.opts.git !== false) {
        const dir = dirname(this.path);
        await execa("git", ["add", basename(this.path)], { cwd: dir, reject: false });
        await execa("git", ["commit", "-q", "-m", `spec(${basename(this.path)}): ${applied.length} delta(s)`], { cwd: dir, reject: false });
      }
    }
    return { applied, dropped };
  }

  /** Reject a batch: nothing applies; repeated rejections escalate the model. */
  reject(): void {
    this.consecutiveRejections += 1;
  }

  tokens(): { in: number; out: number } {
    return { ...this.usage };
  }
}

/** `ser spec check` — the five spec gates (SPEC-v0.2 §5.3), mechanical subset. */
export function checkSpec(spec: Spec): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;

  // 1. schema — parsing already proved it
  lines.push("✓ schema valid");

  // 2+3. claims + adversarial (recorded verdicts)
  const pending = unverifiedLoadBearing(spec);
  if (pending.length > 0) {
    ok = false;
    for (const p of pending) lines.push(`✗ claims: ${p.decision} rests on ${p.claim} (not verified)`);
  } else lines.push("✓ all load-bearing claims verified");

  // 4. executability pre-gates (unanchored requirements, refuted decisions)
  const refusal = specPreGate(spec);
  if (refusal) {
    ok = false;
    for (const r of refusal.reasons) lines.push(`✗ ${r}`);
    for (const rem of refusal.remediations) {
      lines.push(`  ${rem.requirement}: ${rem.options.map((o) => o.split(":")[0]).join(" | ")}`);
    }
  } else lines.push("✓ executability pre-gates (anchoring, decisions, blocking questions)");

  lines.push(ok ? "spec: READY to compile (ser derive <file>)" : "spec: NOT ready");
  return { ok, lines };
}

/**
 * `ser spec verify <claim-id>` — run the adversarial lenses on one ledger
 * claim and record the verdict. Survival across all lenses marks the claim
 * verified with the lens evidence trail (A27: v0.2's working definition of
 * verified is adversarial-survival); a refutation WITH evidence marks refuted.
 */
export async function verifyClaim(
  spec: Spec,
  claimId: string,
  llm: LlmClient,
  model: string,
): Promise<{ spec: Spec; verdict: "verified" | "refuted"; evidence: string }> {
  const { LENSES } = await import("./derive2.js");
  const claim = spec.claims.find((c) => c.id === claimId);
  if (!claim) throw new SquireError("CLAIM_NOT_FOUND", `claim ${claimId} not in the ledger`);

  const evidence: string[] = [];
  let refutedBy = "";
  for (const lens of LENSES) {
    const res = await llm.complete({
      model,
      system: `${lens.instruction} Output ONLY JSON: {"refuted": boolean, "evidence": "shown arithmetic or named sources — REQUIRED when refuted"}.`,
      user: `CLAIM: ${claim.statement}`,
      json: true,
      maxTokens: 1500,
    });
    const parsed = tryParseJson(res.text);
    if (!parsed.ok) continue;
    const v = z.object({ refuted: z.boolean(), evidence: z.string().default("") }).safeParse(parsed.value);
    if (!v.success) continue;
    if (v.data.refuted && v.data.evidence.trim().length >= 10) {
      refutedBy = `[${lens.id}] ${v.data.evidence}`;
      break;
    }
    evidence.push(`[${lens.id}] survived${v.data.evidence ? `: ${v.data.evidence}` : ""}`);
  }

  const verdict = refutedBy ? "refuted" : "verified";
  const updated = applyDeltas(spec, [
    {
      section: "claims",
      op: "modify",
      id: claimId,
      value: { status: verdict, evidence: refutedBy || `survived adversarial lenses on ${model}: ${evidence.join("; ")}` },
      drift: false,
    },
  ]);
  return { spec: updated, verdict, evidence: refutedBy || evidence.join("; ") };
}
