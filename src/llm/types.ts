/** Planner + any non-engine model calls go through this interface (SPEC §7). */
export interface LlmClient {
  complete(req: {
    model: string;
    system: string;
    user: string;
    json?: boolean;
    maxTokens: number;
  }): Promise<{ text: string; inTokens: number; outTokens: number }>;
}
