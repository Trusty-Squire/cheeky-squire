import { Agent, type AgentTool, type AgentEvent } from "@earendil-works/pi-agent-core";
import {
  Type,
  EventStream,
  type Model,
  type AssistantMessage,
  type TextContent,
  type ImageContent,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { ToolExecutor } from "./tools.js";
import { renderPackedFiles } from "../harness/context.js";
import type { AttemptRequest, Engine, EngineEvent, ModelRef, ToolName } from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_BLAST_VIOLATIONS = 3;

export interface PiEngineOptions {
  /** Inject a fake stream function for tests (no network). Default: pi-ai streamSimple. */
  streamFn?: StreamFn;
}

/**
 * PiEngine — real agent execution via @earendil-works/pi-agent-core.
 *
 * The harness owns the four tool bodies (read/write/edit/bash) and the single
 * ToolExecutor, which enforces blast-radius BEFORE any write. Out-of-radius
 * write/edit calls are denied there and surfaced as blast_denied events; the
 * run continues (SPEC §5.4). 3 violations abort the attempt.
 */
export class PiEngine implements Engine {
  private readonly streamFn?: StreamFn;

  constructor(opts: PiEngineOptions = {}) {
    this.streamFn = opts.streamFn;
  }

  async *runAttempt(req: AttemptRequest): AsyncIterable<EngineEvent> {
    const model = buildModel(req.model);
    const exec = new ToolExecutor(req.cwd, req.tools);
    const out = new EventStream<EngineEvent, null>(
      () => false,
      () => null,
    );
    const state: { denied: number; agent?: Agent; aborted: boolean } = { denied: 0, aborted: false };
    let finalText = "";

    const tools = makeTools(exec, (id, name, path, reason) => {
      state.denied += 1;
      out.push({ kind: "blast_denied", id, name, path, reason });
      if (state.denied >= MAX_BLAST_VIOLATIONS) {
        state.aborted = true;
        state.agent?.abort();
      }
    });

    const agent = new Agent({
      initialState: { systemPrompt: req.systemPrompt, model, tools },
      getApiKey: () => req.model.apiKey,
      ...(this.streamFn ? { streamFn: this.streamFn } : {}),
    });
    state.agent = agent;

    agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case "tool_execution_start":
          out.push({
            kind: "tool_call",
            id: event.toolCallId,
            name: event.toolName as ToolName,
            args: event.args,
          });
          break;
        case "tool_execution_end":
          out.push({
            kind: "tool_result",
            id: event.toolCallId,
            ok: !event.isError,
            output: contentText(event.result?.content),
          });
          break;
        case "turn_end": {
          const m = event.message;
          if (isAssistant(m)) {
            out.push({ kind: "usage", inTokens: m.usage.input, outTokens: m.usage.output });
            const text = assistantText(m);
            if (text) finalText = text;
          }
          break;
        }
        default:
          break;
      }
    });

    const userPrompt =
      req.files.length > 0
        ? `${req.brief}\n\n=== CONTEXT FILES (read-only unless writable) ===\n${renderPackedFiles(req.files)}`
        : req.brief;

    const run = (async () => {
      try {
        await agent.prompt(userPrompt);
        if (state.aborted) {
          out.push({ kind: "error", message: `attempt aborted after ${MAX_BLAST_VIOLATIONS} blast-radius violations` });
        } else {
          out.push({ kind: "done", finalMessage: finalText || agent.state.errorMessage || "" });
        }
      } catch (err) {
        out.push({ kind: "error", message: (err as Error).message });
      } finally {
        out.end(null);
      }
    })();

    for await (const ev of out) yield ev;
    await run;
  }
}

/** Construct a pi-ai Model for an arbitrary slug (placeholder-friendly, via OpenRouter). */
function buildModel(ref: ModelRef): Model<"openai-completions"> {
  return {
    id: ref.slug,
    name: ref.slug,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: ref.baseUrl ?? DEFAULT_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

type DenyHook = (id: string, name: ToolName, path: string, reason: string) => void;

function makeTools(exec: ToolExecutor, onDeny: DenyHook): AgentTool<any>[] {
  const text = (s: string): { content: TextContent[]; details: unknown } => ({
    content: [{ type: "text", text: s || "(no output)" }],
    details: null,
  });

  const read: AgentTool<any> = {
    name: "read",
    label: "Read",
    description: "Read a UTF-8 file's contents, relative to the working directory.",
    parameters: Type.Object({ path: Type.String({ description: "File path relative to workdir" }) }),
    execute: async (_id, params) => text((await exec.execute("read", params)).output),
  };

  const write: AgentTool<any> = {
    name: "write",
    label: "Write",
    description: "Create or overwrite a file. Only paths inside the writable set are allowed.",
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
    }),
    execute: async (id, params) => {
      const r = await exec.execute("write", params);
      if (r.denied) onDeny(id, "write", r.path ?? readPath(params), r.deniedReason ?? "denied");
      return text(r.output);
    },
  };

  const edit: AgentTool<any> = {
    name: "edit",
    label: "Edit",
    description: "Replace a substring in an existing file. Only writable paths are allowed.",
    parameters: Type.Object({
      path: Type.String(),
      oldString: Type.String(),
      newString: Type.String(),
      replaceAll: Type.Optional(Type.Boolean()),
    }),
    execute: async (id, params) => {
      const r = await exec.execute("edit", params);
      if (r.denied) onDeny(id, "edit", r.path ?? readPath(params), r.deniedReason ?? "denied");
      return text(r.output);
    },
  };

  const bash: AgentTool<any> = {
    name: "bash",
    label: "Bash",
    description: "Run a shell command in the working directory (e.g. the check command).",
    parameters: Type.Object({ command: Type.String() }),
    execute: async (_id, params) => text((await exec.execute("bash", params)).output),
  };

  return [read, write, edit, bash];
}

function readPath(params: unknown): string {
  if (typeof params === "object" && params !== null && "path" in params) {
    const p = (params as { path: unknown }).path;
    if (typeof p === "string") return p;
  }
  return "";
}

function isAssistant(m: unknown): m is AssistantMessage {
  return typeof m === "object" && m !== null && (m as { role?: string }).role === "assistant";
}

function assistantText(m: AssistantMessage): string {
  return m.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
}

function contentText(content: (TextContent | ImageContent)[] | undefined): string {
  if (!content) return "";
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}
