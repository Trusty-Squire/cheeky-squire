import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDotEnv, loadDotEnv, configDir, globalEnvPath, upsertEnvVar } from "../src/env.js";

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

describe("configDir (one owned location)", () => {
  it("CASTELLAN_HOME wins, then XDG_CONFIG_HOME/castellan", () => {
    expect(configDir({ CASTELLAN_HOME: "/opt/cas" })).toBe("/opt/cas");
    expect(configDir({ XDG_CONFIG_HOME: "/x" })).toBe(join("/x", "castellan"));
    expect(globalEnvPath({ CASTELLAN_HOME: "/opt/cas" })).toBe(join("/opt/cas", ".env"));
  });
});

describe("loadDotEnv (fixed locations, never walks up the tree)", () => {
  it("reads cwd .env.local > cwd .env > global; real env always wins; ancestors ignored", () => {
    const home = mkdtempSync(join(tmpdir(), "env-home-"));
    const cfg = join(home, "castellan");
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, ".env"), "OPENROUTER_API_KEY=from-global\nGLOBAL_ONLY=g");

    const root = mkdtempSync(join(tmpdir(), "env-tree-"));
    const cwd = join(root, "a", "b");
    mkdirSync(cwd, { recursive: true });
    // An ancestor .env that must be IGNORED (the old walk-up footgun).
    writeFileSync(join(root, ".env"), "ANCESTOR=leaked");
    writeFileSync(join(cwd, ".env"), "PROJECT=env\nOVERRIDE=from-env");
    writeFileSync(join(cwd, ".env.local"), "OVERRIDE=from-local");

    const env: NodeJS.ProcessEnv = { CASTELLAN_HOME: cfg, OPENROUTER_API_KEY: "real-shell-key" };
    const set = loadDotEnv(cwd, env);

    expect(env.OPENROUTER_API_KEY).toBe("real-shell-key"); // real env wins over global file
    expect(env.OVERRIDE).toBe("from-local"); // .env.local beats .env in cwd
    expect(env.PROJECT).toBe("env");
    expect(env.GLOBAL_ONLY).toBe("g"); // global still contributes
    expect(env.ANCESTOR).toBeUndefined(); // NOT walked up
    expect(set).toContain("GLOBAL_ONLY");
    expect(set).not.toContain("ANCESTOR");
  });

  it("global file supplies the key when cwd has none", () => {
    const home = mkdtempSync(join(tmpdir(), "env-home2-"));
    const cfg = join(home, "castellan");
    mkdirSync(cfg, { recursive: true });
    writeFileSync(join(cfg, ".env"), "OPENROUTER_API_KEY=from-global");
    const cwd = mkdtempSync(join(tmpdir(), "env-cwd2-"));
    const env: NodeJS.ProcessEnv = { CASTELLAN_HOME: cfg };
    loadDotEnv(cwd, env);
    expect(env.OPENROUTER_API_KEY).toBe("from-global");
  });
});

describe("upsertEnvVar (one place, preserves the rest, mode 600)", () => {
  it("creates the file and parent dir with mode 600", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "upsert-")), "castellan");
    const file = join(dir, ".env");
    upsertEnvVar(file, "OPENROUTER_API_KEY", "sk-or-abc");
    expect(parseDotEnv(readFileSync(file, "utf8")).OPENROUTER_API_KEY).toBe("sk-or-abc");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("updates the key in place, leaving other vars untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "upsert2-"));
    const file = join(dir, ".env");
    writeFileSync(file, "OTHER=keep\nOPENROUTER_API_KEY=old\nALSO=stays\n");
    upsertEnvVar(file, "OPENROUTER_API_KEY", "new");
    const parsed = parseDotEnv(readFileSync(file, "utf8"));
    expect(parsed).toEqual({ OTHER: "keep", OPENROUTER_API_KEY: "new", ALSO: "stays" });
  });
});
