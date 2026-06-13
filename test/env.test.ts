import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDotEnv, loadDotEnv } from "../src/env.js";

describe("parseDotEnv", () => {
  it("handles export prefix, quotes, comments, blank lines", () => {
    const r = parseDotEnv(
      [
        "# comment",
        "",
        "PLAIN=abc",
        "export EXPORTED=def",
        'DOUBLE="with spaces"',
        "SINGLE='single'",
        "not a kv line",
        "TRAIL= padded ",
      ].join("\n"),
    );
    expect(r).toEqual({
      PLAIN: "abc",
      EXPORTED: "def",
      DOUBLE: "with spaces",
      SINGLE: "single",
      TRAIL: "padded",
    });
  });
});

describe("loadDotEnv (the real environment always wins)", () => {
  it("nearest file wins; .env.local beats .env; existing env vars are never overridden", () => {
    const root = mkdtempSync(join(tmpdir(), "env-"));
    const child = join(root, "a", "b");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(root, ".env"), "FROM_ROOT=root\nSHADOWED=root\nPRESET=file");
    writeFileSync(join(child, ".env"), "SHADOWED=child-env\nLOCAL_BEATS=env");
    writeFileSync(join(child, ".env.local"), "LOCAL_BEATS=local");
    const env: NodeJS.ProcessEnv = { PRESET: "real-env" };
    const set = loadDotEnv(child, env);
    expect(env.FROM_ROOT).toBe("root");
    expect(env.SHADOWED).toBe("child-env");
    expect(env.LOCAL_BEATS).toBe("local");
    expect(env.PRESET).toBe("real-env");
    expect(set.sort()).toEqual(["FROM_ROOT", "LOCAL_BEATS", "SHADOWED"]);
  });

  it("no dotenv files in the tree: our keys stay unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-none-"));
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv(dir, env); // stray /tmp/.env on a dev box must not fail this
    expect(env.FROM_ROOT).toBeUndefined();
    expect(env.LOCAL_BEATS).toBeUndefined();
  });
});
