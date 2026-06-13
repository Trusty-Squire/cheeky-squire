import { describe, it, expect } from "vitest";
import { sanitizeInput } from "../src/term.js";

describe("sanitizeInput", () => {
  it("passes normal typed lines through, trimmed", () => {
    expect(sanitizeInput("build a fox companion\n")).toEqual({ text: "build a fox companion", noise: false });
    expect(sanitizeInput("  hello  ")).toEqual({ text: "hello", noise: false });
  });

  it("a real empty line (just Enter) returns empty, NOT noise — it still exits the loop", () => {
    expect(sanitizeInput("\n")).toEqual({ text: "", noise: false });
    expect(sanitizeInput("")).toEqual({ text: "", noise: false });
  });

  it("pure SGR mouse codes are noise (no newline) — caller re-reads instead of exiting", () => {
    expect(sanitizeInput("\x1b[<0;12;7M")).toEqual({ text: "", noise: true });
    expect(sanitizeInput("\x1b[<0;12;7m")).toEqual({ text: "", noise: true });
  });

  it("X10 mouse and cursor-position reports are noise", () => {
    expect(sanitizeInput("\x1b[M !!").noise).toBe(true);
    expect(sanitizeInput("\x1b[12;40R").noise).toBe(true);
  });

  it("strips escape codes that arrive glued to a real typed line", () => {
    expect(sanitizeInput("\x1b[<0;5;5Mbuild it\n")).toEqual({ text: "build it", noise: false });
  });

  it("arrow-key escapes alone are noise", () => {
    expect(sanitizeInput("\x1b[A").noise).toBe(true); // up arrow
    expect(sanitizeInput("\x1b[D").noise).toBe(true); // left arrow
  });
});
