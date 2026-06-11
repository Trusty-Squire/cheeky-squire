import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initRepo,
  head,
  commitNode,
  resetTo,
  changedFilesSince,
  dirtyFiles,
  isClean,
} from "../../src/harness/checkpoint.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "squire-ckpt-"));
  writeFileSync(join(repo, "a.txt"), "one\n");
});

describe("checkpoint", () => {
  it("inits, commits a node, and tracks the green sha", async () => {
    const base = await initRepo(repo);
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    writeFileSync(join(repo, "b.txt"), "two\n");
    const sha = await commitNode(repo, "node-1");
    expect(sha).not.toBe(base);
    expect(await isClean(repo)).toBe(true);
    expect(await head(repo)).toBe(sha);
  });

  it("resets hard to a green checkpoint and removes untracked files", async () => {
    const base = await initRepo(repo);
    writeFileSync(join(repo, "a.txt"), "mutated\n");
    writeFileSync(join(repo, "scratch.txt"), "junk\n");
    expect(await isClean(repo)).toBe(false);
    await resetTo(repo, base);
    expect(await isClean(repo)).toBe(true);
    expect(existsSync(join(repo, "scratch.txt"))).toBe(false);
  });

  it("reports changed files since a sha (tracked + untracked)", async () => {
    const base = await initRepo(repo);
    writeFileSync(join(repo, "a.txt"), "changed\n");
    writeFileSync(join(repo, "new.txt"), "new\n");
    const changed = await changedFilesSince(repo, base);
    expect(changed).toContain("a.txt");
    expect(changed).toContain("new.txt");
  });

  it("lists dirty files via porcelain", async () => {
    await initRepo(repo);
    writeFileSync(join(repo, "a.txt"), "edited\n");
    const dirty = await dirtyFiles(repo);
    expect(dirty).toEqual(["a.txt"]);
    rmSync(join(repo, "a.txt"));
  });
});
