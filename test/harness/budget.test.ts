import { describe, it, expect } from "vitest";
import { BudgetMeter, priceUsd } from "../../src/harness/budget.js";

const prices = {
  "qwen/qwen3-coder": { in: 0.2, out: 0.8 },
  "anthropic/claude-opus-4": { in: 15.0, out: 75.0 },
};

describe("priceUsd", () => {
  it("computes per-million cost", () => {
    const { costUsd, priced } = priceUsd(prices, "qwen/qwen3-coder", 1_000_000, 1_000_000);
    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(1.0, 6); // 0.2 + 0.8
  });

  it("treats an unpriced slug as 0 cost", () => {
    const { costUsd, priced } = priceUsd(prices, "mystery/model", 1_000_000, 1_000_000);
    expect(priced).toBe(false);
    expect(costUsd).toBe(0);
  });
});

describe("BudgetMeter", () => {
  it("tracks node and global spend and flags the node cap", () => {
    const m = new BudgetMeter(prices, 10.0);
    m.beginNode(0.5);
    const first = m.charge("anthropic/claude-opus-4", 10_000, 10_000);
    // 10k*15/1e6 + 10k*75/1e6 = 0.15 + 0.75 = 0.90 > 0.5 node cap
    expect(first.nodeExceeded).toBe(true);
    expect(first.globalExceeded).toBe(false);
    expect(m.nodeSpent()).toBeCloseTo(0.9, 6);
  });

  it("flags the global hard cap and resets node meter per node", () => {
    const m = new BudgetMeter(prices, 1.0);
    m.beginNode(100);
    m.charge("anthropic/claude-opus-4", 100_000, 0); // 1.5 > 1.0 global cap
    expect(m.globalExceeded()).toBe(true);
    m.beginNode(100);
    expect(m.nodeSpent()).toBe(0);
    expect(m.globalSpent()).toBeCloseTo(1.5, 6); // global persists
  });
});
