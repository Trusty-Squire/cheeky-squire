import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Parse a dotenv file: KEY=VALUE lines, optional `export `, quotes, # comments. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

/** ser's single owned config dir: $CASTELLAN_HOME, else $XDG_CONFIG_HOME/castellan, else ~/.config/castellan. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CASTELLAN_HOME && env.CASTELLAN_HOME.trim()) return env.CASTELLAN_HOME;
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : join(homedir(), ".config");
  return join(xdg, "castellan");
}

/** The ONE place the API key lives: ~/.config/castellan/.env. */
export function globalEnvPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), ".env");
}

/**
 * Load ser's environment from a SMALL, FIXED set of locations — never by
 * walking up the tree (that made the effective key depend on cwd and on
 * stray ancestor .env files). Precedence, first writer wins, and the real
 * process environment always wins over every file:
 *   1. <cwd>/.env.local   — project override, gitignored
 *   2. <cwd>/.env         — project config (chains, base url)
 *   3. ~/.config/castellan/.env   — the ONE global home for the API key
 * Returns the variable names this call set.
 */
export function loadDotEnv(cwd: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const set: string[] = [];
  const files = [join(cwd, ".env.local"), join(cwd, ".env"), globalEnvPath(env)];
  for (const p of files) {
    if (!existsSync(p)) continue;
    let parsed: Record<string, string>;
    try {
      parsed = parseDotEnv(readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (env[k] === undefined) {
        env[k] = v;
        set.push(k);
      }
    }
  }
  return set;
}

/**
 * Set one KEY=VALUE in a dotenv file, preserving every other line. Creates
 * the file (and parent dir) at mode 600 — it holds secrets. Used by
 * `ser login` to write the API key to exactly one place.
 */
export function upsertEnvVar(filePath: string, key: string, value: string): void {
  const re = new RegExp(`^(?:export\\s+)?${key}\\s*=`);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const kept = existing.filter((l) => !re.test(l.trim()));
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === "") kept.pop();
  kept.push(`${key}=${value}`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, kept.join("\n") + "\n", { mode: 0o600 });
}
