import picomatch from "picomatch";

/**
 * Build a matcher for a set of globs (e.g. blast_radius). Paths are matched
 * as POSIX-relative. A path matches if ANY glob matches it.
 */
export function makeMatcher(globs: string[]): (path: string) => boolean {
  if (globs.length === 0) return () => false;
  const isMatch = picomatch(globs, { dot: true });
  return (path: string) => isMatch(toPosix(path));
}

/** True if `path` is allowed by any glob in `globs`. */
export function matchesAny(path: string, globs: string[]): boolean {
  return makeMatcher(globs)(path);
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
