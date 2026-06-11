import type { ChainsFile } from "../contract/schema.js";
import { priceUsd } from "../llm/pricing.js";

export { priceUsd };

export interface ChargeResult {
  costUsd: number;
  nodeUsd: number;
  globalUsd: number;
  /** True if this charge pushed the per-node meter over its cap. */
  nodeExceeded: boolean;
  /** True if this charge pushed the global meter over its hard cap. */
  globalExceeded: boolean;
  /** True if the slug had no price entry (cost counted as 0). */
  unpricedModel: boolean;
}

/**
 * Hard-stop budget meter. Global cap is a HARD ceiling (mission halts);
 * node cap failing an attempt advances the escalation rung.
 */
export class BudgetMeter {
  private readonly prices: ChainsFile["prices"];
  private readonly globalCapUsd: number;
  private globalUsd = 0;
  private nodeUsd = 0;
  private nodeCapUsd = Infinity;

  constructor(prices: ChainsFile["prices"], globalCapUsd: number) {
    this.prices = prices;
    this.globalCapUsd = globalCapUsd;
  }

  /** Reset the per-node meter at the start of a node (across all its attempts). */
  beginNode(capUsd: number): void {
    this.nodeUsd = 0;
    this.nodeCapUsd = capUsd;
  }

  /** Charge an LLM call's usage; returns the cost and whether any cap is now exceeded. */
  charge(slug: string, inTokens: number, outTokens: number): ChargeResult {
    const { costUsd, priced } = priceUsd(this.prices, slug, inTokens, outTokens);
    this.globalUsd += costUsd;
    this.nodeUsd += costUsd;
    return {
      costUsd,
      nodeUsd: this.nodeUsd,
      globalUsd: this.globalUsd,
      nodeExceeded: this.nodeUsd > this.nodeCapUsd,
      globalExceeded: this.globalUsd > this.globalCapUsd,
      unpricedModel: !priced,
    };
  }

  globalSpent(): number {
    return this.globalUsd;
  }

  nodeSpent(): number {
    return this.nodeUsd;
  }

  globalExceeded(): boolean {
    return this.globalUsd > this.globalCapUsd;
  }
}
