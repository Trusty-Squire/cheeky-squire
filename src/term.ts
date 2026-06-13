/**
 * Terminal input sanitation. Phone/SSH terminals with mouse tracking on emit
 * escape sequences (cursor reports, SGR mouse like `\x1b[<0;12;7M`) into stdin.
 * Raw, those leak into the prompt and — worse — a mouse twitch that reduces to
 * an empty string would read as "user pressed enter on an empty line" and exit
 * the session. We strip the noise and tell the caller when a chunk was PURELY
 * noise (no real newline) so it re-reads instead of treating it as input.
 */

/* eslint-disable no-control-regex -- matching terminal control bytes is the whole point */
// CSI sequences: ESC [ ... final byte (covers SGR mouse `\x1b[<...M/m` and cursor reports).
const CSI = /\x1b\[[0-9;?<>]*[ -/]*[@-~]/g;
// X10 mouse: ESC [ M then three bytes.
const X10_MOUSE = /\x1b\[M[\s\S]{0,3}/g;
// Two-char escape sequences (ESC + single char) and a lone trailing ESC.
const SHORT_ESC = /\x1b[@-Z\\-_]?/g;
// Remaining non-printable control chars, keeping tab; newlines handled separately.
const OTHER_CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
/* eslint-enable no-control-regex */

export function sanitizeInput(raw: string): { text: string; noise: boolean } {
  const hadEsc = raw.includes("\x1b");
  const hadNewline = /[\r\n]/.test(raw);
  const text = raw
    .replace(X10_MOUSE, "")
    .replace(CSI, "")
    .replace(SHORT_ESC, "")
    .replace(OTHER_CTRL, "")
    .replace(/[\r\n]+/g, "")
    .trim();
  // Pure escape/mouse noise: nothing typed, escape bytes present, and the user
  // did not actually press enter. The caller should keep waiting.
  const noise = text === "" && hadEsc && !hadNewline;
  return { text, noise };
}
