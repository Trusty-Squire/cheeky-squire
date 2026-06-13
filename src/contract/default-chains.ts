/**
 * Built-in default chains so `ser talk`/`do`/`fix` run in ANY directory with
 * no chains.yaml authored. Same pinned slugs + per-million prices as the
 * repo's chains.yaml (verified live on OpenRouter, 2026-06). A project
 * chains.yaml or ~/.config/castellan/chains.yaml overrides this wholesale.
 * Kept as YAML text so it validates through the one parseChains code path.
 */
export const DEFAULT_CHAINS_YAML = `chains:
  cheap:
    executor: "qwen/qwen3-coder"
    fallback: "deepseek/deepseek-chat"
    knight: "anthropic/claude-opus-4"
  knight-only:
    executor: "anthropic/claude-opus-4"
    fallback: "anthropic/claude-opus-4"
    knight: "anthropic/claude-opus-4"
  cheap-raw:
    executor: "qwen/qwen3-coder"
    fallback: "qwen/qwen3-coder"
    knight: "qwen/qwen3-coder"
    harness: "off"
prices:
  "qwen/qwen3-coder": { in: 0.30, out: 1.00 }
  "deepseek/deepseek-chat": { in: 0.20, out: 0.80 }
  "anthropic/claude-opus-4": { in: 15.0, out: 75.0 }
`;

/** Marker source label used when no chains file is found and defaults apply. */
export const BUILTIN_CHAINS_SOURCE = "<built-in defaults>";
