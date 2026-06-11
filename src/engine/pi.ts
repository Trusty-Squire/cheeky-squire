import type { AttemptRequest, Engine, EngineEvent } from "./types.js";
import { SquireError } from "../errors.js";

/**
 * PiEngine — real agent execution via @earendil-works/pi-agent-core.
 * Implemented in Phase 2. Placeholder until then so the CLI's non-mock path
 * type-checks; the demo and all tests use MockEngine.
 */
export class PiEngine implements Engine {
  // eslint-disable-next-line require-yield
  async *runAttempt(_req: AttemptRequest): AsyncIterable<EngineEvent> {
    throw new SquireError("ENGINE_UNAVAILABLE", "PiEngine is implemented in Phase 2; use --mock");
  }
}
