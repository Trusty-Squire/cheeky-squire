import { SquireError } from "../errors.js";
import type { LlmClient } from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter LlmClient: POST /chat/completions with OPENROUTER_API_KEY.
 * 2 retries with backoff on 429/5xx. Used only by the planner (derive);
 * the engine talks to providers through pi-ai.
 */
export class OpenRouterClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async complete(req: {
    model: string;
    system: string;
    user: string;
    json?: boolean;
    maxTokens: number;
  }): Promise<{ text: string; inTokens: number; outTokens: number }> {
    const body = {
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens,
      temperature: 0,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
    };

    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await this.sleep(250 * 2 ** (attempt - 1));
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastErr = `network error: ${(err as Error).message}`;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new SquireError("LLM_HTTP", `OpenRouter HTTP ${res.status}: ${text.slice(0, 500)}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      return {
        text,
        inTokens: json.usage?.prompt_tokens ?? 0,
        outTokens: json.usage?.completion_tokens ?? 0,
      };
    }
    throw new SquireError("LLM_RETRY", `OpenRouter failed after retries: ${lastErr}`);
  }
}
