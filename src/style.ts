/**
 * Minimal, dependency-free ANSI styling for the talk REPL. Colors are emitted
 * only to an interactive TTY (and never when NO_COLOR is set), so piped output,
 * logs, and tests stay plain. A full split-pane TUI is a separate later effort.
 */
export interface Styler {
  enabled: boolean;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  gray(s: string): string;
  bold(s: string): string;
  dim(s: string): string;
}

export function makeStyler(enabled: boolean): Styler {
  const wrap = (code: string) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    enabled,
    red: wrap("31"),
    green: wrap("32"),
    yellow: wrap("33"),
    cyan: wrap("36"),
    gray: wrap("90"),
    bold: wrap("1"),
    dim: wrap("2"),
  };
}

/** Honor NO_COLOR (any value disables) and FORCE_COLOR; otherwise follow the TTY. */
export function colorsEnabled(env: NodeJS.ProcessEnv = process.env, isTty = Boolean(process.stdout.isTTY)): boolean {
  if (env.NO_COLOR != null) return false;
  if (env.FORCE_COLOR === "1" || env.FORCE_COLOR === "true") return true;
  return isTty;
}

/** Color the per-turn delta summary: + adds green, - removes red, ~ modifies yellow. */
export function styleDeltaSummary(
  deltas: { op: string; section: string; id?: string; drift?: boolean }[],
  s: Styler,
): string {
  return deltas
    .map((d) => {
      const sign = d.op === "add" ? "+" : d.op === "remove" ? "-" : "~";
      const color = d.op === "add" ? s.green : d.op === "remove" ? s.red : s.yellow;
      const token = `${sign}${d.section}${d.id ? ":" + d.id : ""}`;
      return color(token) + (d.drift ? s.bold(s.red("⚠drift")) : "");
    })
    .join(" ");
}
