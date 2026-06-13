import { readFileSync, existsSync } from "node:fs";
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

/**
 * Load .env.local / .env from startDir upward to the filesystem root.
 * Precedence: the real environment ALWAYS wins, then the nearest file,
 * with .env.local over .env in the same directory. Returns the names set.
 */
export function loadDotEnv(startDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const set: string[] = [];
  let dir = startDir;
  for (;;) {
    for (const name of [".env.local", ".env"]) {
      const p = join(dir, name);
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
    const parent = dirname(dir);
    if (parent === dir) return set;
    dir = parent;
  }
}
