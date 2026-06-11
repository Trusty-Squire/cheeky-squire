# ENGINE_NOTES.md — Phase 0 pi-mono audit

Timeboxed single pass. Goal: answer SPEC §6.2's questions with
evidence (package names, file paths, type signatures), then decide
PiEngine vs BuiltinEngine.

## Provenance

- GitHub org/repo: originally `github.com/badlogic/pi-mono`
  (Mario Zechner, npm maintainer `badlogic`). The maintained line
  has **moved** to `github.com/earendil-works/pi`.
- The `@mariozechner/pi-ai` and `@mariozechner/pi-agent-core`
  packages on npm now carry `DEPRECATED!! - please use
  @earendil-works/... instead going forward`.
- We therefore target the maintained scope `@earendil-works/*`.

Verified via `npm view` (not guessed):

| package | latest | role |
|---|---|---|
| `@earendil-works/pi-ai` | 0.79.1 | unified LLM transport (providers, `streamSimple`, `Model`, `Usage`) |
| `@earendil-works/pi-agent-core` | 0.79.1 | agent loop: tools, tool-call hooks, event stream |

Both installed as direct deps (see `package.json`). Types read from
`node_modules/@earendil-works/<pkg>/dist/*.d.ts`.

## §6.2 Q1 — Package names
Answered above: `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`.
`pi-agent-core` depends on `pi-ai`. Tool parameter schemas use `typebox`
(re-exported from pi-ai as `Type`, `type Static`, `type TSchema`).

## §6.2 Q2 — Constructing an agent session programmatically
`pi-agent-core` exports a stateful `Agent` class
(`dist/agent.d.ts`):

```ts
new Agent(options?: AgentOptions)
//   options.initialState?: { systemPrompt, model: Model<any>, tools: AgentTool[], thinkingLevel }
//   options.streamFn?: StreamFn      // defaults to pi-ai streamSimple
//   options.beforeToolCall?(ctx, signal): Promise<{ block?: boolean; reason?: string } | undefined>
//   options.afterToolCall?(ctx, signal): Promise<AfterToolCallResult | undefined>
agent.subscribe((event: AgentEvent, signal) => void | Promise<void>): () => void
agent.prompt(text: string): Promise<void>   // runs the loop to completion
agent.abort(): void
agent.state: AgentState                       // { messages, model, tools, ... }
```

`AgentEvent` (`dist/types.d.ts`) is the lifecycle stream we map to our
`EngineEvent`: `agent_start`, `turn_start`, `message_update`
(carries `assistantMessageEvent` with text deltas), `tool_execution_start`
`{ toolCallId, toolName, args }`, `tool_execution_end`
`{ toolCallId, toolName, result, isError }`, `turn_end`
`{ message: AssistantMessage }`, `agent_end { messages }`.

We bridge the callback `subscribe` stream into an `AsyncIterable`
(pi-ai also ships `EventStream<T,R>` in `dist/utils/event-stream.d.ts`,
an `AsyncIterable` with `push`/`end`/`result`, which we reuse for the
bridge).

## §6.2 Q3 — Intercepting / customizing tool execution
Two independent mechanisms, both used by PiEngine:

1. **Tool definition is ours.** `AgentTool<TParameters extends TSchema>`
   (`dist/types.d.ts`) extends pi-ai's `Tool` with:
   ```ts
   execute(toolCallId, params, signal?, onUpdate?): Promise<AgentToolResult<TDetails>>
   ```
   So *we* write the read/write/edit/bash bodies (fs + execa). pi never
   touches the filesystem; the harness's `ToolExecutor` does.

2. **Pre-execution gate.** `beforeToolCall(ctx, signal)` runs *after*
   argument validation and *before* `execute`. Returning
   `{ block: true, reason }` denies the call — "The loop emits an error
   tool result instead" (quoted from `dist/types.d.ts`
   `BeforeToolCallResult`). This is exactly SPEC §5.4's "checked against
   blast_radius BEFORE execution … structured error injected as the tool
   result, run continues." Blast-radius enforcement is therefore
   harness-owned deterministic code, never trusted to the model.

## §6.2 Q4 — Provider / model selection
`Model<TApi>` (`pi-ai/dist/types.d.ts`) is a **plain object**, not a
registry handle:
```ts
interface Model<TApi> { id; name; api; provider; baseUrl; reasoning;
  input; cost:{input;output;cacheRead;cacheWrite}; contextWindow;
  maxTokens; headers?; compat? }
```
`getModel(provider, id)` exists for built-in slugs, but because `Model`
is a literal we **construct one directly** for any slug — required since
SPEC ships placeholder slugs (`qwen/qwen3-coder`, …) the user pins
later. For OpenRouter we set `api:"openai-completions"`,
`provider:"openrouter"`, `baseUrl:"https://openrouter.ai/api/v1"`, and
pass the key per-call. `streamSimple(model, context, { apiKey, maxTokens,
signal })` (`pi-ai/dist/stream.d.ts`) does the HTTP. The `compat` field
lets us set `thinkingFormat`/`openRouterRouting` per provider family
without code changes.

## §6.2 Q5 — Usage token reporting
Every `AssistantMessage` carries `usage: Usage`
(`pi-ai/dist/types.d.ts`):
```ts
interface Usage { input; output; cacheRead; cacheWrite; totalTokens;
  cost:{ input; output; cacheRead; cacheWrite; total } }
```
We read it off the `turn_end`/`message_end` `AssistantMessage` and emit
an `EngineEvent { kind:"usage", inTokens: usage.input, outTokens:
usage.output }`. We compute USD ourselves from `chains.yaml` prices
(SPEC requires prices be user config, so we do **not** rely on pi's
`cost`/`calculateCost`).

## §6.2 Q6 — Reasoning trace fields (DeepSeek reasoning_content)
pi-ai models reasoning as first-class `ThinkingContent`
(`{ type:"thinking", thinking, thinkingSignature?, redacted? }`) inside
`AssistantMessage.content`, and exposes per-family wire formats via
`OpenAICompletionsCompat.thinkingFormat` (`"deepseek" | "openrouter" |
"qwen" | …`). DeepSeek's `reasoning_content` is parsed into thinking
blocks automatically. For the harness we surface thinking as `text`
events (informational) and never feed it back as instructions; it does
not affect gates.

## Blast-radius wiring (SPEC §5.4) — concrete plan
- A single harness `ToolExecutor.execute(name, args, policy, cwd)` does
  the real fs/execa work and is the *one* place writes happen.
- It is shared: **MockEngine** routes each scripted `tool_call` through
  it (real writes, no LLM — SPEC §6.4); **PiEngine**'s `AgentTool.execute`
  delegates to it.
- Radius check happens before any write in `ToolExecutor`, and is
  mirrored in PiEngine's `beforeToolCall` for the "deny + inject error +
  continue, 3 strikes → attempt fails" path. The runner counts
  `blast_denied` events.

## DECISION

**PiEngine: feasible.** Evidence: (1) programmatic session via `Agent`
(`pi-agent-core/dist/agent.d.ts`); (2) harness-owned tool bodies via
`AgentTool.execute` plus a pre-execution `beforeToolCall` block hook
(`pi-agent-core/dist/types.d.ts`) matching SPEC §5.4 exactly;
(3) arbitrary placeholder slugs via hand-constructed `Model` +
`streamSimple` with per-call `apiKey`/`baseUrl`
(`pi-ai/dist/{types,stream}.d.ts`); (4) `Usage` tokens on every
`AssistantMessage`; (5) reasoning handled via `ThinkingContent` +
`compat.thinkingFormat`. No capability gap forces the BuiltinEngine
contingency. We implement **PiEngine** in Phase 2 behind the `Engine`
interface, with blast-radius interception in the harness.
