import { vi } from "vitest";
import { ClaudeSdkAdapter } from "./claude-sdk-adapter.js";
import type { BrowserOutgoingMessage } from "./session-types.js";
import type { WsBridge } from "./ws-bridge.js";

/**
 * Test double for a Claude Code process behind the real `ClaudeSdkAdapter`.
 *
 * Tests feed Claude stream-json output with `message()` exactly as the CLI
 * prints it; the real adapter translates it and the bridge handles it through
 * the production SDK attach path. Only the SDK query and its prompt input (the
 * process boundary) are faked, so what Takode sends back to Claude is observable
 * on `userTurns` (prompts) and `outgoing` (permission answers, interrupts, ...).
 */
export interface ClaudeSdkTestBackend {
  readonly sessionId: string;
  readonly adapter: ClaudeSdkAdapter;
  /** Prompts delivered to Claude's input stream. */
  readonly userTurns: ReturnType<typeof vi.fn>;
  /** Control calls on the SDK query. */
  readonly query: {
    interrupt: ReturnType<typeof vi.fn>;
    setPermissionMode: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
    applyFlagSettings: ReturnType<typeof vi.fn>;
  };
  /** Messages Takode routed to the adapter, in order. */
  readonly outgoing: BrowserOutgoingMessage[];
  /** Answers given to Claude's permission requests, keyed by request ID. */
  readonly permissionDecisions: Map<string, unknown>;
  /** Text of each prompt delivered to Claude, in order. */
  promptTexts(): string[];
  /** Forget everything sent to Claude so far. */
  clearSent(): void;
  /** Attach to the bridge as a freshly started Claude process. */
  attach(bridge: WsBridge): ClaudeSdkTestBackend;
  /** Deliver newline-delimited Claude output; blank lines are ignored. */
  message(ndjson: string): void;
  /** Simulate the Claude process exiting. */
  disconnect(): void;
}

export function createClaudeSdkTestBackend(sessionId: string): ClaudeSdkTestBackend {
  const initialize = vi.spyOn(ClaudeSdkAdapter.prototype as any, "initialize").mockResolvedValue(undefined);
  const adapter = new ClaudeSdkAdapter(sessionId, { cwd: "/test" });
  initialize.mockRestore();

  const userTurns = vi.fn((_prompt: unknown) => {});
  const query = {
    interrupt: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async (_mode: string) => {}),
    setModel: vi.fn(async () => {}),
    applyFlagSettings: vi.fn(async (_settings: unknown) => {}),
  };
  const internals = adapter as any;
  internals.sdkQuery = { ...query, close: vi.fn() };
  internals.prompts = { push: userTurns, end: vi.fn() };
  internals.connected = true;

  const outgoing: BrowserOutgoingMessage[] = [];
  const originalSend = adapter.sendBrowserMessage.bind(adapter);
  adapter.sendBrowserMessage = (msg: BrowserOutgoingMessage) => {
    outgoing.push(msg);
    return originalSend(msg);
  };

  const permissionDecisions = new Map<string, unknown>();
  const permissionAborts = new Map<string, AbortController>();

  const deliver = (msg: any) => {
    if (msg.type === "control_request" && msg.request?.subtype === "can_use_tool") {
      // The CLI's canUseTool callback, keeping the test's request ID.
      const abort = new AbortController();
      permissionAborts.set(msg.request_id, abort);
      void internals
        .requestPermission(msg.request_id, msg.request.tool_name, msg.request.input, {
          signal: abort.signal,
          suggestions: msg.request.permission_suggestions,
          description: msg.request.description,
          toolUseID: msg.request.tool_use_id,
          agentID: msg.request.agent_id,
        })
        .then((decision: unknown) => permissionDecisions.set(msg.request_id, decision));
      return;
    }
    if (msg.type === "control_cancel_request") {
      permissionAborts.get(msg.request_id)?.abort();
      return;
    }
    internals.handleSdkMessage(msg);
  };

  const backend: ClaudeSdkTestBackend = {
    sessionId,
    adapter,
    userTurns,
    query,
    outgoing,
    permissionDecisions,
    promptTexts() {
      return userTurns.mock.calls.map(([prompt]) => promptText(prompt));
    },
    clearSent() {
      userTurns.mockClear();
      query.interrupt.mockClear();
      query.setPermissionMode.mockClear();
      query.setModel.mockClear();
      query.applyFlagSettings.mockClear();
      outgoing.length = 0;
    },
    attach(bridge) {
      bridge.attachClaudeSdkAdapter(sessionId, adapter);
      return backend;
    },
    message(ndjson) {
      for (const line of ndjson.split("\n")) {
        if (line.trim()) deliver(JSON.parse(line));
      }
    },
    disconnect() {
      internals.handleDisconnect();
    },
  };
  return backend;
}

function promptText(prompt: unknown): string {
  if (typeof prompt === "string") return prompt;
  const content = (prompt as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("\n");
}

/** Create a test Claude process and attach it to the bridge in one step. */
export function attachClaudeSdkTestBackend(bridge: WsBridge, sessionId: string): ClaudeSdkTestBackend {
  return createClaudeSdkTestBackend(sessionId).attach(bridge);
}

/**
 * Module factory for `vi.mock("@anthropic-ai/claude-agent-sdk", ...)`: records the
 * options of every query the real adapter starts, and keeps each one idle.
 */
export function fakeAgentSdkModule(queryOptions: any[]) {
  return {
    query: vi.fn(({ options }: { options: unknown }) => {
      queryOptions.push(options);
      return {
        close: vi.fn(),
        [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
      };
    }),
  };
}
