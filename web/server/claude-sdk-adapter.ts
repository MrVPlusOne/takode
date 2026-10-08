import { serverWorkAdmission } from "./server-work-admission.js";
/**
 * Claude SDK Adapter
 *
 * Bridges between the Agent SDK's stdio transport (via @anthropic-ai/claude-agent-sdk)
 * and The Companion's BrowserIncomingMessage/BrowserOutgoingMessage types.
 *
 * This is the only supported Claude transport (see docs/claude-backend.md). Liveness
 * follows the process lifecycle; the bridge handles disconnect/relaunch and
 * generation-state edge cases above the adapter layer. Follows the same pattern as
 * CodexAdapter for consistency.
 */

import { randomUUID } from "node:crypto";
import type {
  EffortLevel,
  Options as SdkQueryOptions,
  PermissionMode as SdkPermissionMode,
  Query as SdkQuery,
} from "@anthropic-ai/claude-agent-sdk";
import { stripInheritedTelemetryEnv, withNonInteractiveGitEditorEnv } from "./cli-launcher-env.js";
import { getEnrichedPath } from "./path-resolver.js";
import { recordClaudeModelCatalog } from "./claude-model-catalog.js";
import {
  formatVsCodeSelectionPrompt,
  type BrowserIncomingMessage,
  type BrowserOutgoingMessage,
  type PermissionRequest,
  type PermissionUpdate,
  type VsCodeSelectionMetadata,
} from "./session-types.js";
import type { RecorderManager } from "./recorder.js";
import { trafficStats } from "./traffic-stats.js";
import type {
  BackendAdapter,
  CompactRequestedAwareAdapter,
  ClaudeTurnAwareAdapter,
  PendingOutgoingAwareAdapter,
} from "./bridge/adapter-interface.js";

/**
 * Claude Code retries a failed model request 10 times by default (about 3
 * minutes when the connection is refused) and clamps this setting to 15
 * (about 6 minutes; measured with 2.1.289). Its maximum lets most network
 * outages end inside the original turn, so Takode rarely has to send a hidden
 * continue. Any explicitly configured value wins.
 */
const CLAUDE_MAX_RETRIES_DEFAULT = "15";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ClaudeSdkAdapterOptions {
  model?: string;
  cwd: string;
  permissionMode?: string;
  reasoningEffort?: string;
  betas?: string[];
  cliSessionId?: string;
  /** When resuming, keep only conversation history through this assistant message UUID (Revert). */
  resumeSessionAt?: string;
  env?: Record<string, string | undefined>;
  /** Claude Code program to run; a bare `claude` for a remote host, which resolves it itself. */
  claudeBinary?: string;
  /**
   * Start the Claude process through a host's `takode node` (a registered
   * remote host, or this machine's own node) instead of as a child here.
   */
  spawnProcess?: (options: {
    command: string;
    args: string[];
    cwd?: string;
    env: Record<string, string | undefined>;
    signal: AbortSignal;
  }) => unknown;
  /**
   * `spawnProcess` hands over a Claude process a previous coordinator started,
   * still running under a host's node after a coordinator restart. Claude answers
   * the SDK's `initialize` with "Already initialized" and the permission
   * requests it is still waiting for, which the SDK then asks again.
   */
  reattach?: boolean;
  debugFile?: string;
  recorder?: RecorderManager | null;
  /** Plugin directories to pass to Claude Code */
  pluginDirs?: string[];
  /** Tools Claude may use without asking (`--allowedTools`). */
  allowedTools?: string[];
  /** Companion instructions injected via appendSystemPrompt in the control init. */
  instructions?: string;
  /**
   * Called once when the Claude process fails to start or ends unexpectedly.
   * Not called for an intentional `disconnect()`. Lets the launcher keep its
   * lifecycle state truthful; the bridge's own failure callbacks are separate.
   */
  onBackendExit?: (error: string) => void;
}

export interface ClaudeSdkSessionMeta {
  cliSessionId?: string;
  model?: string;
  tools?: string[];
  permissionMode?: string;
}

type PermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: "deny"; message: string };

/** Options the Agent SDK passes to `canUseTool` (note the SDK's `toolUseID`/`agentID` casing). */
type CanUseToolOptions = {
  signal: AbortSignal;
  suggestions?: any[];
  description?: string;
  toolUseID?: string;
  agentID?: string;
};

interface PendingPermission {
  resolve: (result: PermissionDecision) => void;
  reject: (err: Error) => void;
  requestId: string;
  toolName: string;
  /** Original tool input — used as updatedInput fallback when browser approves
   *  without providing modified input. The CLI's Zod schema requires updatedInput
   *  to be a Record matching the tool's input shape, not undefined or {}. */
  originalInput: Record<string, unknown>;
}

/** A user message on Claude's stream-json input. */
type ClaudeInputMessage = {
  type: "user";
  message: { role: "user"; content: Array<{ type: "text"; text: string }> };
  parent_tool_use_id: null;
  session_id: string;
};

/**
 * Claude's input for the whole process lifetime: the SDK reads prompts from it
 * as they arrive, and ending it closes Claude's stdin.
 */
class PromptStream implements AsyncIterable<ClaudeInputMessage> {
  private queued: ClaudeInputMessage[] = [];
  private waiting: ((result: IteratorResult<ClaudeInputMessage>) => void) | null = null;
  private ended = false;

  push(msg: ClaudeInputMessage): void {
    if (this.ended) return;
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting) waiting({ value: msg, done: false });
    else this.queued.push(msg);
  }

  end(): void {
    this.ended = true;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<ClaudeInputMessage> {
    return {
      next: () => {
        const msg = this.queued.shift();
        if (msg) return Promise.resolve({ value: msg, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

// ─── Adapter ────────────────────────────────────────────────────────────────────

export class ClaudeSdkAdapter
  implements
    BackendAdapter<ClaudeSdkSessionMeta>,
    PendingOutgoingAwareAdapter,
    CompactRequestedAwareAdapter,
    ClaudeTurnAwareAdapter
{
  private sessionId: string;
  private options: ClaudeSdkAdapterOptions;
  /** The SDK query driving the Claude process; also its control channel. */
  private sdkQuery: SdkQuery | null = null;
  private prompts: Pick<PromptStream, "push" | "end"> | null = null;
  /** Settles true once the Claude process has spawned, false if startup failed. */
  readonly started: Promise<boolean>;
  private settleStarted: (started: boolean) => void = () => {};
  private connected = false;
  private browserMessageCb: ((msg: BrowserIncomingMessage) => void) | null = null;
  private sessionMetaCb: ((meta: ClaudeSdkSessionMeta) => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private initErrorCb: ((error: string) => void) | null = null;
  private compactRequestedCb: (() => void) | null = null;
  private pendingPermissions = new Map<string, PendingPermission>();
  private pendingOutgoing: BrowserOutgoingMessage[] = [];
  /** True from handing Claude a prompt until its turn's result arrives. */
  private turnInFlight = false;
  /** Cached MCP servers from the last session_init, used to respond to mcp_get_status. */
  private cachedMcpServers: Array<{ name: string; status: string }> = [];

  constructor(sessionId: string, options: ClaudeSdkAdapterOptions) {
    this.sessionId = sessionId;
    this.options = options;
    this.started = new Promise((resolve) => {
      this.settleStarted = resolve;
    });
    // Start initialization asynchronously
    this.initialize().catch((err) => {
      console.error(`[claude-sdk-adapter] Init failed for session ${sessionId}:`, err);
      const error = err instanceof Error ? err.message : String(err);
      this.settleStarted(false);
      this.options.onBackendExit?.(error);
      this.initErrorCb?.(error);
    });
  }

  // ─── Public interface (matches CodexAdapter) ────────────────────────────────

  /** Accept a message from the browser and send it to the CLI */
  sendBrowserMessage(msg: BrowserOutgoingMessage): boolean {
    if (serverWorkAdmission.isStopping()) return false;
    if (!this.connected || !this.sdkQuery) {
      this.pendingOutgoing.push(msg);
      return false;
    }
    return this.dispatchOutgoing(msg);
  }

  onBrowserMessage(cb: (msg: BrowserIncomingMessage) => void): void {
    this.browserMessageCb = cb;
  }

  onSessionMeta(cb: (meta: ClaudeSdkSessionMeta) => void): void {
    this.sessionMetaCb = cb;
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCb = cb;
  }

  onInitError(cb: (error: string) => void): void {
    this.initErrorCb = cb;
  }

  onCompactRequested(cb: () => void): void {
    this.compactRequestedCb = cb;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Whether this adapter took over a running Claude process (see `reattach`). */
  get reattached(): boolean {
    return !!this.options.reattach;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.turnInFlight = false;
    try {
      // Ends Claude's input, then stops the process after a short grace period.
      this.sdkQuery?.close();
      this.prompts?.end();
    } catch {
      /* ignore */
    }
    // Reject any pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.reject(new Error("Session disconnected"));
    }
    this.pendingPermissions.clear();
  }

  drainPendingOutgoing(): BrowserOutgoingMessage[] {
    return this.pendingOutgoing.splice(0);
  }

  /** Whether Claude has a prompt from Takode that has not produced a result yet. */
  hasTurnInFlight(): boolean {
    return this.turnInFlight;
  }

  /** Drop user messages still waiting for the process to start; returns how many. */
  discardPendingUserMessages(): number {
    const kept = this.pendingOutgoing.filter((msg) => msg.type !== "user_message");
    const discarded = this.pendingOutgoing.length - kept.length;
    this.pendingOutgoing = kept;
    return discarded;
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  private async initialize(): Promise<void> {
    // Dynamic import keeps SDK loading off the server startup path.
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    if (serverWorkAdmission.isStopping()) {
      this.settleStarted(false);
      return;
    }

    // Merge process.env (inherits ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN from
    // claude.sh) with session-specific vars (COMPANION_SESSION_ID, etc.)
    // Enrich PATH so the SDK can find the `claude` binary and companion skills
    // (e.g., quest CLI in ~/.companion/bin). Without this, SDK sessions can't
    // find binaries that aren't on the default system PATH.
    const mergedEnv: Record<string, string | undefined> = withNonInteractiveGitEditorEnv({
      CLAUDE_CODE_MAX_RETRIES: CLAUDE_MAX_RETRIES_DEFAULT,
      ...stripInheritedTelemetryEnv(process.env),
      ...(this.options.env || {}),
      // A Takode server started from inside Claude Code must not trip the CLI's nesting guard.
      CLAUDECODE: undefined,
      PATH: getEnrichedPath({ serverId: this.options.env?.COMPANION_SERVER_ID }),
    });

    // Build the plugins list from pluginDirs
    const plugins = (this.options.pluginDirs ?? []).map((path) => ({ type: "local" as const, path }));
    const resuming = !!this.options.cliSessionId;

    // NOTE: Always provide canUseTool, even in bypassPermissions mode.
    // The ws-bridge permission pipeline handles mode-based auto-approval
    // (including bypassPermissions) while still routing interactive tools
    // (ExitPlanMode, AskUserQuestion) to the browser for user interaction.
    // Without canUseTool, the CLI handles permissions internally and these
    // interactive tools fail silently — the user never sees the plan
    // approval dialog or question form.
    const queryOptions: SdkQueryOptions = {
      cwd: this.options.cwd,
      permissionMode: this.mapPermissionMode(this.options.permissionMode) as SdkQueryOptions["permissionMode"],
      env: mergedEnv,
      canUseTool: this.handleCanUseTool.bind(this) as unknown as SdkQueryOptions["canUseTool"],
      settingSources: ["user", "project", "local"],
      // query() starts from an empty system prompt unless told otherwise; keep
      // Claude Code's own prompt, with Takode's instructions appended.
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        ...(this.options.instructions ? { append: this.options.instructions } : {}),
      },
      ...(plugins.length > 0 ? { plugins } : {}),
      ...(this.options.allowedTools?.length ? { allowedTools: this.options.allowedTools } : {}),
      // Otherwise Claude Code reads the model from settings.json (loaded via settingSources).
      ...(this.options.model ? { model: this.options.model } : {}),
      // Without a configured binary the SDK runs the Claude Code bundled with it.
      ...(this.options.claudeBinary ? { pathToClaudeCodeExecutable: this.options.claudeBinary } : {}),
      ...(this.options.spawnProcess
        ? { spawnClaudeCodeProcess: this.options.spawnProcess as SdkQueryOptions["spawnClaudeCodeProcess"] }
        : {}),
      ...(this.options.debugFile ? { debugFile: this.options.debugFile } : {}),
      ...(this.options.reasoningEffort ? { effort: this.options.reasoningEffort as SdkQueryOptions["effort"] } : {}),
      ...(this.options.betas?.length ? { betas: this.options.betas as SdkQueryOptions["betas"] } : {}),
      ...(resuming ? { resume: this.options.cliSessionId } : {}),
      // Revert: keep only the conversation through this assistant message.
      ...(resuming && this.options.resumeSessionAt ? { resumeSessionAt: this.options.resumeSessionAt } : {}),
    };

    console.log(
      `[claude-sdk-adapter] Creating session ${this.sessionId} with options:`,
      JSON.stringify({
        cwd: this.options.cwd,
        permissionMode: queryOptions.permissionMode,
        model: queryOptions.model ?? "(from settings.json)",
        reasoningEffort: this.options.reasoningEffort ?? null,
        betas: this.options.betas ?? [],
        settingSources: queryOptions.settingSources,
        plugins: plugins.map((p) => p.path),
        claudeBinary: this.options.claudeBinary ?? "(default)",
        debugFile: this.options.debugFile ?? null,
        appendSystemPrompt: this.options.instructions?.length ?? 0,
      }),
    );

    // Starts the process right away (the session passes `cwd` to the spawn
    // itself, so a remote host gets its own path); prompts follow on `prompts`.
    const prompts = new PromptStream();
    const sdkQuery = sdk.query({ prompt: prompts as AsyncIterable<any>, options: queryOptions });
    this.prompts = prompts;
    this.sdkQuery = sdkQuery;

    this.connected = true;
    this.watchProcessStart();
    // A reattached process answers `initialize` with an error, so it reports no catalog.
    if (!this.options.reattach) this.recordModelCatalog();
    console.log(`[claude-sdk-adapter] Session ${this.sessionId} initialized${resuming ? " (resumed)" : ""}`);

    // Flush pending outgoing messages
    for (const msg of this.pendingOutgoing.splice(0)) {
      this.dispatchOutgoing(msg);
    }

    void this.streamMessages(sdkQuery);
  }

  // ─── Message streaming ──────────────────────────────────────────────────────

  /**
   * Relay Claude's output for the life of the process. The query yields every
   * turn's messages and ends only once Claude's output closes (the process
   * exited or was killed), or throws when the process fails.
   */
  private async streamMessages(sdkQuery: AsyncIterable<unknown>): Promise<void> {
    try {
      for await (const msg of sdkQuery) {
        this.handleSdkMessage(msg);
      }
      if (this.connected) {
        console.warn(`[claude-sdk-adapter] Claude output ended for session ${this.sessionId}`);
      }
      this.handleDisconnect();
    } catch (err) {
      if (this.connected) {
        const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        console.error(`[claude-sdk-adapter] Stream error for session ${this.sessionId}: ${errMsg}`);
        this.handleDisconnect(err instanceof Error ? err.message : String(err));
      }
    }
  }

  // ─── SDK Message → BrowserIncomingMessage translation ───────────────────────

  private handleSdkMessage(msg: any): void {
    if (!msg || typeof msg.type !== "string") return;

    // Record raw incoming message
    const raw = JSON.stringify(msg);
    this.options.recorder?.record(this.sessionId, "in", raw, "cli", "claude-sdk", this.options.cwd);
    trafficStats.record({
      sessionId: this.sessionId,
      channel: "cli",
      direction: "in",
      messageType: typeof msg.subtype === "string" && msg.subtype ? `${msg.type}.${msg.subtype}` : msg.type,
      payloadBytes: Buffer.byteLength(raw, "utf-8"),
    });

    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init") {
          // Extract session metadata
          const meta: ClaudeSdkSessionMeta = {
            cliSessionId: msg.session_id,
            model: msg.model,
            tools: msg.tools,
            permissionMode: msg.permissionMode,
          };
          this.sessionMetaCb?.(meta);

          // Cache MCP servers for later mcp_get_status queries
          this.cachedMcpServers = msg.mcp_servers || [];

          // Forward as session_init
          this.emitBrowserMessage({
            type: "session_init",
            session: {
              session_id: msg.session_id,
              model: msg.model,
              cwd: msg.cwd || this.options.cwd,
              tools: msg.tools || [],
              permissionMode: msg.permissionMode || "default",
              claude_code_version: msg.claude_code_version,
              mcp_servers: msg.mcp_servers || [],
              agents: msg.agents || [],
              slash_commands: msg.slash_commands || [],
              skills: msg.skills || [],
            },
          } as any);
        } else if (msg.subtype === "status") {
          this.emitBrowserMessage({
            type: "status_change",
            status: msg.status || "idle",
          } as any);
        } else if (msg.subtype === "task_notification") {
          // Forward background agent completion notifications so the bridge
          // can persist them and the browser can show sub-agent chip state.
          this.emitBrowserMessage({
            type: "task_notification",
            task_id: msg.task_id,
            tool_use_id: msg.tool_use_id,
            status: msg.status,
            output_file: msg.output_file,
            summary: msg.summary,
          } as any);
        } else if (msg.subtype === "compact_boundary") {
          // Forward compaction boundary markers so the bridge can track
          // compaction state for SDK sessions.
          this.emitBrowserMessage(msg as BrowserIncomingMessage);
        } else if (msg.subtype === "api_retry") {
          // Claude retries failed model requests itself; the bridge uses these
          // to show that a turn is waiting for the network.
          this.emitBrowserMessage(msg as BrowserIncomingMessage);
        }
        break;
      }

      case "result":
        this.turnInFlight = false;
        this.emitBrowserMessage(msg as BrowserIncomingMessage);
        break;

      case "assistant":
      case "stream_event":
      case "tool_progress":
      case "tool_use_summary":
      case "keep_alive":
        // These types match directly between SDK and our protocol
        this.emitBrowserMessage(msg as BrowserIncomingMessage);
        break;

      default:
        // Forward unknown types as-is — the browser can handle or ignore them
        this.emitBrowserMessage(msg as BrowserIncomingMessage);
        break;
    }
  }

  // ─── Permission bridging ────────────────────────────────────────────────────

  /** Called by the Agent SDK when a tool needs permission */
  private handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionDecision> {
    return this.requestPermission(randomUUID(), toolName, input, options);
  }

  private async requestPermission(
    requestId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionDecision> {
    const toolUseId = options.toolUseID || randomUUID();

    // Create a permission request and emit it to the browser
    const permRequest: PermissionRequest = {
      request_id: requestId,
      tool_name: toolName,
      input,
      tool_use_id: toolUseId,
      timestamp: Date.now(),
      ...(options.description ? { description: options.description } : {}),
      ...(options.agentID ? { agent_id: options.agentID } : {}),
      ...(options.suggestions ? { permission_suggestions: options.suggestions } : {}),
    };

    // Wait for the browser/server to respond.
    // IMPORTANT: Register the pending promise BEFORE emitting the permission
    // request. The server may auto-approve mode-based permissions (Write in
    // acceptEdits mode) synchronously within the emitBrowserMessage call chain,
    // which calls sendBrowserMessage → dispatchOutgoing → pendingPermissions.get().
    // If the promise isn't registered yet, the approval is silently dropped and
    // the tool hangs until the SDK's abort signal fires (~3.5 minutes).
    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, {
        resolve,
        reject: (err: Error) => {
          // On unexpected errors, resolve with deny (never reject — rejected promises
          // confuse the SDK's retry logic and cause the session to loop through
          // alternative approaches without permission).
          resolve({ behavior: "deny", message: err.message || "Permission request failed" });
        },
        requestId,
        toolName,
        originalInput: input,
      });

      // Handle abort signal — resolve with deny, don't reject
      options.signal.addEventListener(
        "abort",
        () => {
          // Claude withdrew the request (e.g. the turn was interrupted); let the
          // bridge retire its pending banner like any other cancelled request.
          if (this.pendingPermissions.delete(requestId)) {
            this.emitBrowserMessage({ type: "control_cancel_request", request_id: requestId } as any);
          }
          resolve({ behavior: "deny", message: "Permission request aborted" });
        },
        { once: true },
      );

      // Now emit the permission request — this may trigger synchronous auto-approval
      this.emitBrowserMessage({
        type: "permission_request",
        request: permRequest,
      } as any);
    });
  }

  // ─── Outgoing message dispatch ──────────────────────────────────────────────

  private dispatchOutgoing(msg: BrowserOutgoingMessage): boolean {
    if (serverWorkAdmission.isStopping()) return false;
    if (!this.sdkQuery || !this.prompts || !this.connected) return false;

    const msgType = (msg as any).type;
    trafficStats.record({
      sessionId: this.sessionId,
      channel: "cli",
      direction: "out",
      messageType: typeof msgType === "string" && msgType ? msgType : "unknown",
      payloadBytes: Buffer.byteLength(JSON.stringify(msg), "utf-8"),
    });

    switch (msgType) {
      case "user_message": {
        const content = (msg as any).content;
        const vscodeSelection = (msg as any).vscodeSelection as VsCodeSelectionMetadata | undefined;
        const selectionText = vscodeSelection ? formatVsCodeSelectionPrompt(vscodeSelection) : null;
        if (!content && !selectionText) return true;

        // /compact interception is handled by ws-bridge.routeBrowserMessage
        // before timestamp tagging. The adapter just forwards it to the CLI.
        // Raw image payloads are rejected by routeBrowserMessage's ingress
        // guard before reaching this adapter -- no image handling needed here.

        // A VSCode selection rides along as a second text block so the model
        // sees both the user text and the selection hint.
        const blocks: Array<{ type: "text"; text: string }> = [{ type: "text", text: content }];
        if (selectionText) blocks.push({ type: "text", text: selectionText });
        this.turnInFlight = true;
        this.prompts.push({
          type: "user",
          message: { role: "user", content: blocks },
          parent_tool_use_id: null,
          session_id: "",
        });
        return true;
      }

      case "permission_response": {
        const requestId = (msg as any).request_id;
        const behavior = (msg as any).behavior;
        const pending = this.pendingPermissions.get(requestId);
        if (pending) {
          this.pendingPermissions.delete(requestId);
          if (behavior === "allow") {
            const updatedInput = (msg as any).updated_input;
            const updatedPermissions = (msg as any).updated_permissions as PermissionUpdate[] | undefined;
            // Always provide updatedInput — the CLI's Zod schema requires a Record,
            // not undefined. Use browser-provided input if non-empty, otherwise fall
            // back to the original tool input from the permission request.
            pending.resolve({
              behavior: "allow",
              updatedInput: updatedInput && Object.keys(updatedInput).length > 0 ? updatedInput : pending.originalInput,
              // Chosen "Always allow" suggestions persist as Claude permission rules.
              ...(updatedPermissions?.length ? { updatedPermissions } : {}),
            });
          } else {
            pending.resolve({
              behavior: "deny",
              message: (msg as any).message || "Denied by user",
            });
          }
        }
        return true;
      }

      case "interrupt": {
        // Sends a control_request {subtype:"interrupt"} to the CLI process.
        this.sdkQuery.interrupt().catch((err: Error) => {
          console.error(`[claude-sdk-adapter] Interrupt failed for session ${this.sessionId}:`, err);
        });
        console.log(`[claude-sdk-adapter] Interrupt sent for session ${this.sessionId}`);
        return true;
      }

      case "set_permission_mode": {
        // The CLI's own mode decides which tool calls reach canUseTool at all:
        // bypassPermissions never asks, and auto lets Claude's classifier approve
        // safe actions itself. A server-only change would leave the CLI in its old
        // mode, so forward it.
        const mode = (this.mapPermissionMode((msg as any).mode) ?? "default") as SdkPermissionMode;
        this.sdkQuery.setPermissionMode(mode).catch((err: Error) => {
          console.error(`[claude-sdk-adapter] setPermissionMode failed for session ${this.sessionId}:`, err);
        });
        console.log(`[claude-sdk-adapter] Permission mode changed to "${mode}" for session ${this.sessionId}`);
        return true;
      }

      case "set_model": {
        // The model must reach the CLI so it uses it for the next API call.
        const model = (msg as any).model;
        this.sdkQuery.setModel(model).catch((err: Error) => {
          console.error(`[claude-sdk-adapter] setModel failed for session ${this.sessionId}:`, err);
        });
        console.log(`[claude-sdk-adapter] Model changed to "${model}" for session ${this.sessionId}`);
        return true;
      }

      case "set_claude_reasoning_effort": {
        // Effort set through the flag-settings layer replaces the process's
        // live effort, including one passed as --effort at launch; null
        // returns to Claude's default.
        const effortLevel = ((msg as { effort: string }).effort || null) as EffortLevel | null;
        this.sdkQuery.applyFlagSettings({ effortLevel }).catch((err: Error) => {
          console.error(`[claude-sdk-adapter] Effort change failed for session ${this.sessionId}:`, err);
        });
        return true;
      }

      case "mcp_get_status": {
        // The Claude Code SDK doesn't expose runtime MCP status queries.
        // Return the cached server list from the last session_init -- this
        // gives the browser the same data it received on connect, which is
        // sufficient for UI display.
        const servers = this.cachedMcpServers.map((s) => ({
          name: s.name,
          status: s.status as "connected" | "failed" | "disabled" | "connecting",
          config: { type: "unknown" },
          scope: "user",
        }));
        this.emitBrowserMessage({ type: "mcp_status", servers } as any);
        return true;
      }

      case "mcp_toggle":
      case "mcp_reconnect":
      case "mcp_set_servers":
        // Consume rather than return false: an unhandled message would be
        // re-queued and replayed on every reconnect.
        this.emitBrowserMessage({
          type: "error",
          message: "Managing MCP servers from Takode is not supported for Claude sessions.",
        });
        return true;

      default:
        console.log(`[claude-sdk-adapter] Unhandled outgoing message type: ${msgType}`);
        return false;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private emitBrowserMessage(msg: BrowserIncomingMessage): void {
    // Don't record here — the bridge's broadcastToBrowsers records the
    // sequenced message after assigning a seq number. Recording in both
    // places doubles every entry in the recording file (one without seq
    // from here, one with seq from the bridge).
    this.browserMessageCb?.(msg);
  }

  /**
   * Settle `started` from the spawned Claude process. The SDK reports a missing
   * or unlaunchable executable only through the process `error` event, after
   * session creation has already returned.
   */
  private watchProcessStart(): void {
    // The SDK's internal process transport; not a public contract.
    const proc = (this.sdkQuery as any)?.transport?.process;
    if (typeof proc?.once !== "function") {
      // SDK internals changed: startup cannot be observed, so keep treating the
      // created session as started. Later failures still arrive as disconnects.
      console.warn(`[claude-sdk-adapter] Cannot observe Claude process startup for session ${this.sessionId}`);
      this.settleStarted(true);
      return;
    }
    proc.once("spawn", () => this.settleStarted(true));
    proc.once("error", () => this.settleStarted(false));
  }

  /** Record the CLI's model catalog once initialization completes, so model menus list what this CLI offers. */
  private recordModelCatalog(): void {
    const query = this.sdkQuery;
    if (typeof query?.supportedModels !== "function") return;
    query.supportedModels().then(recordClaudeModelCatalog, (err: unknown) => {
      console.warn(
        `[claude-sdk-adapter] Could not read the model catalog for session ${this.sessionId}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  private handleDisconnect(error = "Claude process ended"): void {
    if (!this.connected) return;
    this.connected = false;
    this.turnInFlight = false;
    this.settleStarted(false);
    // Reject pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.reject(new Error("Session disconnected"));
    }
    this.pendingPermissions.clear();
    this.options.onBackendExit?.(error);
    this.disconnectCb?.();
  }

  private mapPermissionMode(mode?: string): string | undefined {
    switch (mode) {
      case "default":
      case "bypassPermissions":
      case "acceptEdits":
      case "plan":
      case "auto":
      case "delegate":
      case "dontAsk":
        return mode;
      default:
        return "default";
    }
  }
}
