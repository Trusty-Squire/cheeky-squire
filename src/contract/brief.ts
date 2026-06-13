import { z } from "zod";
import { SpecSchema, type Spec } from "./spec.js";
import type { Decision, IdeaResult } from "./ingest.js";
import type { Styler } from "../style.js";

/**
 * The decision brief (pipeline slice 2). The idea phase's bucketed decisions
 * are resolved with the user: bucket-1 ASKs are presented one at a time
 * (accept / pick / type / skip); bucket-2 DEFAULTS are auto-accepted but SHOWN
 * so a mis-bucket is visible (the brief absorbs imperfect classification — the
 * 38-prompt eval showed the boundary is judgment-laden, so the human is the
 * backstop). The resolved set compiles into a real spec.
 */

export type ResolveMode = "accepted" | "picked" | "custom" | "skipped";

export interface Resolution {
  decision: Decision;
  answer: string;
  mode: ResolveMode;
}

/** Pure: interpret one raw keystroke/line for an ASK. enter=accept, a-z=pick, s=skip, else=type. */
export function applyChoice(d: Decision, raw: string): Resolution {
  const t = raw.trim();
  if (t === "") return { decision: d, answer: d.recommendation, mode: "accepted" };
  if (t.toLowerCase() === "s") return { decision: d, answer: d.recommendation, mode: "skipped" };
  const letter = /^([a-z])$/i.exec(t);
  if (letter) {
    const idx = letter[1]!.toLowerCase().charCodeAt(0) - 97;
    if (idx >= 0 && idx < d.alternatives.length) return { decision: d, answer: d.alternatives[idx]!, mode: "picked" };
  }
  return { decision: d, answer: t.replace(/^t\s+/i, ""), mode: "custom" }; // "t foo" or bare "foo"
}

export function renderAsk(d: Decision, n: number, total: number, st: Styler): string {
  const alts = d.alternatives.map((a, i) => `${String.fromCharCode(97 + i)}) ${a}`).join("   ");
  return [
    st.bold(`[${n}/${total}] ${d.question}`) + (d.why ? st.gray(`  (${d.why.split(/[.;-]/)[0]!.trim().slice(0, 64)})`) : ""),
    `    recommend: ${st.green(d.recommendation)}`,
    alts ? `    ${alts}` : "",
    st.gray("    [enter] accept · a/b/c pick · type your own · s skip"),
  ].filter(Boolean).join("\n");
}

export interface BriefIO {
  print(line: string): void;
  ask(prompt: string): Promise<string>;
}

/** Drive the brief: resolve every ASK, auto-accept + show the defaults. */
export async function resolveBrief(decisions: Decision[], io: BriefIO, st: Styler): Promise<Resolution[]> {
  const asks = decisions.filter((d) => d.bucket === 1);
  const defaults = decisions.filter((d) => d.bucket === 2);
  const out: Resolution[] = [];

  if (asks.length === 0) {
    io.print(st.gray("no decisions need you — proceeding on best judgment."));
  } else {
    io.print(st.bold(`${asks.length} decision(s) for you:`));
    for (let i = 0; i < asks.length; i++) {
      io.print(renderAsk(asks[i]!, i + 1, asks.length, st));
      out.push(applyChoice(asks[i]!, await io.ask(st.gray("  > "))));
    }
  }

  for (const d of defaults) out.push({ decision: d, answer: d.recommendation, mode: "accepted" });
  if (defaults.length > 0) {
    io.print(st.gray(`\n${defaults.length} default(s) ser chose (say so if any is wrong):`));
    for (const d of defaults) io.print(st.gray(`  • ${d.question} → `) + d.recommendation);
  }
  return out;
}

const AcceptanceLike = z.object({ tier: z.number(), gate: z.string().optional(), artifact: z.string().optional() });

/** Coerce the model's proposed gate into a schema-valid acceptance (else tier 0). */
function normAcceptance(g: unknown): { tier: 0 | 1 | 2 | 3 | 4; gate?: string; artifact?: string } {
  const p = AcceptanceLike.safeParse(g);
  if (!p.success) return { tier: 0 };
  const { tier, gate, artifact } = p.data;
  if (tier >= 1 && tier <= 3 && gate) return { tier: tier as 1 | 2 | 3, gate };
  if (tier === 4 && artifact) return { tier: 4, artifact };
  return { tier: 0 };
}

/**
 * Compile idea-phase output + brief resolutions into a spec. Stories and
 * components become first-class; every resolved decision is recorded (a
 * skipped/accepted one is ser's call, a picked/custom one is the user's).
 */
export function ideaToSpec(prompt: string, idea: IdeaResult, resolutions: Resolution[]): Spec {
  const requirements = idea.components.map((c, i) => ({
    id: `R${i + 1}`,
    statement: c.statement,
    acceptance: normAcceptance(c.gate),
  }));
  if (requirements.length === 0) {
    requirements.push({ id: "R1", statement: prompt, acceptance: { tier: 0 } });
  }
  const decisions = resolutions.map((r, i) => ({
    id: `D${i + 1}`,
    statement: `${r.decision.question} → ${r.answer}`,
    rationale: r.mode === "custom" || r.mode === "picked" ? `your call (${r.mode})` : `ser ${r.mode}`,
    claims: [] as string[],
  }));
  return SpecSchema.parse({
    thesis: prompt,
    stories: idea.stories,
    scope_fence: [],
    requirements,
    decisions,
    claims: [],
    open_questions: [],
  });
}
