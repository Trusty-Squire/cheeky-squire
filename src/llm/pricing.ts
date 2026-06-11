import type { ChainsFile } from "../contract/schema.js";

/**
 * USD cost for a single LLM call. Prices are per MILLION tokens (chains.yaml).
 * A missing slug yields 0 cost (price is user-maintained config; we never
 * invent one). Single source of truth for cost, used by budget.ts.
 */
export function priceUsd(
  prices: ChainsFile["prices"],
  slug: string,
  inTokens: number,
  outTokens: number,
): { costUsd: number; priced: boolean } {
  const p = prices[slug];
  if (!p) return { costUsd: 0, priced: false };
  const costUsd = (inTokens / 1_000_000) * p.in + (outTokens / 1_000_000) * p.out;
  return { costUsd, priced: true };
}
