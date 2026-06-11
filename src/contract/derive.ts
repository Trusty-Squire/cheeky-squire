import { SquireError } from "../errors.js";

/**
 * `squire derive "<goal>"` — the planner pass (SPEC §8). Implemented in
 * Phase 3 with the verbatim Appendix A prompt and schema-retry handling.
 */
export async function runDerive(_args: string[]): Promise<number> {
  throw new SquireError("NOT_IMPLEMENTED", "squire derive is implemented in Phase 3");
}
