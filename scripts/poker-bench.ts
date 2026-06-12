/**
 * poker-bench (SPEC-v0.2 §9.3) — does derive refuse plausible-but-infeasible
 * specs, with evidence, without refusing feasible controls?
 *
 *   pnpm poker-bench [--chain cheap]
 *
 * LIVE: needs OPENROUTER_API_KEY; the human runs it. Success gate: >=4/5
 * infeasible specs refused/flagged, <=1 spurious refusal among controls,
 * total cost <= $1.
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseChains, resolveChain } from "../src/contract/schema.js";
import { parseSpec } from "../src/contract/spec.js";
import { deriveV2 } from "../src/contract/derive2.js";
import { OpenRouterClient } from "../src/llm/openrouter.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(argv: string[]): Promise<number> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    process.stderr.write("OPENROUTER_API_KEY required — poker-bench is LIVE (the human runs it)\n");
    return 1;
  }
  const chainName = argv.includes("--chain") ? argv[argv.indexOf("--chain") + 1]! : "cheap";
  const chains = parseChains(readFileSync(join(ROOT, "chains.yaml"), "utf8"));
  const chain = resolveChain(chains, chainName);
  const llm = new OpenRouterClient({ apiKey, baseUrl: process.env.OPENROUTER_BASE_URL });

  const dir = join(ROOT, "specs", "poker-set");
  let infeasibleCaught = 0, infeasibleTotal = 0, spuriousRefusals = 0, controls = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".spec.yaml")).sort()) {
    const isControl = f.startsWith("control-");
    const spec = parseSpec(readFileSync(join(dir, f), "utf8"), f);
    const workdir = mkdtempSync(join(tmpdir(), "poker-"));
    const r = await deriveV2({ spec, workdir, llm, model: chain.executor, chainName, budgetUsd: 1 });
    const refused = !r.ok;
    process.stdout.write(`${f}: ${refused ? "REFUSED" : "compiled"}${refused ? ` — ${(r as { reasons: string[] }).reasons[0]?.slice(0, 140)}` : ""}\n`);
    if (isControl) { controls++; if (refused) spuriousRefusals++; }
    else { infeasibleTotal++; if (refused) infeasibleCaught++; }
  }
  process.stdout.write(`\n--- POKER TEST ---\n`);
  process.stdout.write(`infeasible caught: ${infeasibleCaught}/${infeasibleTotal} (gate: >=4/5)\n`);
  process.stdout.write(`spurious refusals: ${spuriousRefusals}/${controls} (gate: <=1)\n`);
  return infeasibleCaught >= 4 && spuriousRefusals <= 1 ? 0 : 1;
}

main(process.argv.slice(2)).then((c) => process.exit(c));
