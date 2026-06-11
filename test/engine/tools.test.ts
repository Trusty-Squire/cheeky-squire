import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolExecutor } from "../../src/engine/tools.js";

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "squire-tools-"));
  mkdirSync(join(cwd, "src"), { recursive: true });
});

describe("ToolExecutor", () => {
  it("writes within blast radius and records the write", async () => {
    const exec = new ToolExecutor(cwd, { blastRadius: ["src/**"] });
    const r = await exec.execute("write", { path: "src/a.ts", content: "x" });
    expect(r.ok).toBe(true);
    expect(r.denied).toBe(false);
    expect(readFileSync(join(cwd, "src", "a.ts"), "utf8")).toBe("x");
    expect(exec.executedWrites).toEqual(["src/a.ts"]);
  });

  it("DENIES a write outside blast radius before touching disk", async () => {
    const exec = new ToolExecutor(cwd, { blastRadius: ["src/**"] });
    const r = await exec.execute("write", { path: "secrets/key.ts", content: "leak" });
    expect(r.denied).toBe(true);
    expect(r.ok).toBe(false);
    expect(existsSync(join(cwd, "secrets", "key.ts"))).toBe(false);
    expect(exec.executedWrites).toEqual([]);
  });

  it("denies a path that escapes the workdir", async () => {
    const exec = new ToolExecutor(cwd, { blastRadius: ["**"] });
    const r = await exec.execute("write", { path: "../escape.ts", content: "x" });
    expect(r.denied).toBe(true);
    expect(r.output).toMatch(/escapes the workdir/);
  });

  it("edits an existing file by string replacement", async () => {
    writeFileSync(join(cwd, "src", "a.ts"), "const x = 1;");
    const exec = new ToolExecutor(cwd, { blastRadius: ["src/**"] });
    const r = await exec.execute("edit", { path: "src/a.ts", oldString: "1", newString: "2" });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(cwd, "src", "a.ts"), "utf8")).toBe("const x = 2;");
  });

  it("fails an edit when oldString is absent", async () => {
    writeFileSync(join(cwd, "src", "a.ts"), "const x = 1;");
    const exec = new ToolExecutor(cwd, { blastRadius: ["src/**"] });
    const r = await exec.execute("edit", { path: "src/a.ts", oldString: "zzz", newString: "2" });
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/not found/);
  });

  it("reads files and runs bash in cwd", async () => {
    writeFileSync(join(cwd, "src", "a.ts"), "hello");
    const exec = new ToolExecutor(cwd, { blastRadius: ["src/**"] });
    const read = await exec.execute("read", { path: "src/a.ts" });
    expect(read.output).toBe("hello");
    const bash = await exec.execute("bash", { command: "echo hi" });
    expect(bash.ok).toBe(true);
    expect(bash.output).toMatch(/hi/);
  });

  it("honors the denylist", async () => {
    const exec = new ToolExecutor(cwd, { blastRadius: ["**"], denylist: ["bash"] });
    const r = await exec.execute("bash", { command: "echo x" });
    expect(r.denied).toBe(true);
  });
});
