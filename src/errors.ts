/**
 * Typed errors with context. The CLI catches SquireError at the top,
 * prints one clear line (+ trace path if known), and exits 1.
 */
export class SquireError extends Error {
  readonly code: string;
  readonly details?: unknown;
  /** Path to the trace file, attached by the runner when available. */
  tracePath?: string;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "SquireError";
    this.code = code;
    this.details = details;
  }
}

/** Mission was halted because the escalation ladder was exhausted or a hard budget cap was hit. */
export class MissionHaltedError extends SquireError {
  constructor(message: string, details?: unknown) {
    super("MISSION_HALTED", message, details);
    this.name = "MissionHaltedError";
  }
}
