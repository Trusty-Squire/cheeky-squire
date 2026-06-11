import { execa } from "execa";

const TAIL_BYTES = 4096;
export const DEFAULT_GATE_TIMEOUT_MS = 5 * 60 * 1000;

export interface GateResult {
  command: string;
  passed: boolean;
  exitCode: number;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
}

/**
 * Run a done_check as a shell command, judged purely by exit code.
 * No prose evaluation anywhere — exit 0 = pass (SPEC: gates are shell
 * commands judged by exit code).
 */
export async function runGate(
  command: string,
  cwd: string,
  timeoutMs: number = DEFAULT_GATE_TIMEOUT_MS,
): Promise<GateResult> {
  const started = Date.now();
  try {
    const result = await execa(command, {
      cwd,
      shell: true,
      timeout: timeoutMs,
      reject: false,
      all: false,
      stripFinalNewline: false,
    });
    return {
      command,
      passed: result.exitCode === 0 && !result.timedOut,
      exitCode: result.exitCode ?? 1,
      timedOut: Boolean(result.timedOut),
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    // execa with reject:false should not throw for nonzero exits; this catches
    // spawn failures (command not found, etc.) — treat as a hard gate failure.
    const e = err as { shortMessage?: string; message?: string };
    return {
      command,
      passed: false,
      exitCode: 127,
      timedOut: false,
      stdoutTail: "",
      stderrTail: tail(e.shortMessage ?? e.message ?? String(err)),
      durationMs: Date.now() - started,
    };
  }
}

/** Keep only the last TAIL_BYTES of output (utf8), prefixing a marker if truncated. */
function tail(value: string | undefined): string {
  const s = value ?? "";
  if (Buffer.byteLength(s, "utf8") <= TAIL_BYTES) return s;
  const buf = Buffer.from(s, "utf8");
  const sliced = buf.subarray(buf.length - TAIL_BYTES).toString("utf8");
  return `…[truncated]\n${sliced}`;
}
