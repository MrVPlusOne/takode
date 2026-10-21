import type { BrowserIncomingMessage, McpServerConfig, McpServerDetail, SessionState } from "./session-types.js";
import type { JsonRpcTransport } from "./codex-jsonrpc-transport.js";
import type { CodexMcpServerStatus, CodexMcpStatusListResponse } from "./codex-adapter-utils.js";
import { toSafeText } from "./codex-adapter-utils.js";
import { mcpOAuthCallbackProblem, mcpOAuthRedirectUri } from "./mcp-oauth-callback.js";

type EmitFn = (msg: BrowserIncomingMessage) => void;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isMcpServerEnabled(value: unknown): boolean {
  const cfg = asRecord(value);
  if (!cfg) return true;
  return cfg.enabled !== false;
}

function toMcpServerConfig(value: unknown): McpServerConfig {
  const cfg = asRecord(value) || {};
  const args = Array.isArray(cfg.args) ? cfg.args.filter((a): a is string => typeof a === "string") : undefined;
  const env = asRecord(cfg.env) as Record<string, string> | null;

  let type: McpServerConfig["type"] = "sdk";
  if (cfg.type === "stdio" || cfg.type === "sse" || cfg.type === "http" || cfg.type === "sdk") {
    type = cfg.type;
  } else if (typeof cfg.command === "string") {
    type = "stdio";
  } else if (typeof cfg.url === "string") {
    type = "http";
  }

  return {
    type,
    command: typeof cfg.command === "string" ? cfg.command : undefined,
    args,
    env: env || undefined,
    url: typeof cfg.url === "string" ? cfg.url : undefined,
  };
}

function fromMcpServerConfig(config: McpServerConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof config.command === "string") out.command = config.command;
  if (Array.isArray(config.args)) out.args = config.args;
  if (config.env) out.env = config.env;
  if (typeof config.url === "string") out.url = config.url;
  return out;
}

function mapMcpTools(
  tools: Record<string, { name?: string; annotations?: unknown }> | undefined,
): McpServerDetail["tools"] {
  if (!tools) return [];
  return Object.entries(tools).map(([key, tool]) => {
    const ann = asRecord(tool.annotations);
    const annotations = ann
      ? {
          readOnly: (ann.readOnly ?? ann.readOnlyHint) === true,
          destructive: (ann.destructive ?? ann.destructiveHint) === true,
          openWorld: (ann.openWorld ?? ann.openWorldHint) === true,
        }
      : undefined;

    return {
      name: typeof tool.name === "string" ? tool.name : key,
      annotations,
    };
  });
}

/** A sign-in Takode started through Codex's `mcpServer/oauth/login`. */
interface McpSignIn {
  state: "pending" | "failed";
  authorizationUrl?: string;
  loginId?: string;
  redirectUri?: string;
  error?: string;
}

export class CodexMcpManager {
  private mcpStartupStatusByName = new Map<string, McpServerDetail>();
  private mcpServersByName = new Map<string, McpServerDetail>();
  private signIns = new Map<string, McpSignIn>();

  constructor(
    private readonly transport: JsonRpcTransport,
    private readonly emit: EmitFn,
    private readonly sessionId: string,
    private readonly session: {
      /** The session's Codex thread: plugin-provided servers exist only in a thread's configuration. */
      threadId?: () => string | null;
      /** Opens a sign-in callback on the machine running the session. Returns its HTTP status. */
      deliverOAuthCallback?: (callbackUrl: string) => Promise<number>;
    } = {},
  ) {}

  /**
   * Start signing in to an MCP server (including one a plugin provides) and
   * show every browser the sign-in link. Codex finishes the sign-in when the
   * provider redirects to its callback and reports it with
   * `mcpServer/oauthLogin/completed`.
   */
  async handleSignIn(serverName: string): Promise<void> {
    try {
      const response = (await this.transport.call("mcpServer/oauth/login", {
        name: serverName,
        threadId: this.session.threadId?.() ?? null,
      })) as { authorizationUrl?: string; loginId?: string | null };
      const authorizationUrl = toSafeText(response?.authorizationUrl).trim();
      if (!authorizationUrl) throw new Error("Codex returned no sign-in link");
      this.signIns.set(serverName, {
        state: "pending",
        authorizationUrl,
        loginId: response.loginId ?? undefined,
        redirectUri: mcpOAuthRedirectUri(authorizationUrl),
      });
    } catch (err) {
      this.signIns.set(serverName, { state: "failed", error: `Couldn't start the sign-in: ${errorText(err)}` });
    }
    this.emitServers();
  }

  /** Codex finished a sign-in: refresh the server's tools, or show why it failed. */
  async handleSignInCompleted(params: Record<string, unknown>): Promise<void> {
    const name = toSafeText(params.name).trim();
    const current = this.signIns.get(name);
    const loginId = toSafeText(params.loginId).trim();
    // A late result of an earlier attempt must not overwrite the current one.
    if (current?.loginId && loginId && current.loginId !== loginId) return;
    if (params.success === true) {
      this.signIns.delete(name);
      await this.handleReloadAndGetStatus().catch(() => this.emitServers());
      return;
    }
    const reason = toSafeText(params.error).trim() || "the sign-in did not complete";
    this.signIns.set(name, { state: "failed", error: `Sign-in failed: ${reason}` });
    this.emitServers();
  }

  /**
   * Finish a sign-in from a browser that could not reach the session's machine:
   * the user pasted the callback address the provider redirected to.
   */
  async handleSignInCallback(serverName: string, callbackUrl: string): Promise<void> {
    const current = this.signIns.get(serverName);
    if (current?.state !== "pending") {
      this.emit({ type: "error", message: `No sign-in to "${serverName}" is waiting. Start it again.` });
      return;
    }
    const problem = mcpOAuthCallbackProblem(callbackUrl, current.redirectUri);
    if (problem) {
      this.emit({ type: "error", message: problem });
      return;
    }
    if (!this.session.deliverOAuthCallback) {
      this.emit({ type: "error", message: "This session cannot finish a pasted sign-in." });
      return;
    }
    try {
      const status = await this.session.deliverOAuthCallback(callbackUrl.trim());
      if (status >= 400) throw new Error(`the sign-in page answered ${status}`);
    } catch (err) {
      this.emit({ type: "error", message: `Couldn't finish the sign-in to "${serverName}": ${errorText(err)}` });
    }
  }

  handleStartupStatusUpdated(params: Record<string, unknown>): void {
    const name = toSafeText(params.name).trim();
    if (!name) return;

    const rawStatus = toSafeText(params.status).trim();
    const status: McpServerDetail["status"] =
      rawStatus === "ready" ? "connected" : rawStatus === "failed" ? "failed" : "connecting";
    const error = toSafeText(params.error).trim() || undefined;

    const server: McpServerDetail = {
      name,
      status,
      ...(error ? { error } : {}),
      config: { type: "unknown" },
      scope: "session",
      tools: [],
    };

    this.mcpStartupStatusByName.set(name, server);
    const existing = this.mcpServersByName.get(name);
    this.mcpServersByName.set(name, {
      ...existing,
      ...server,
      config: existing?.config ?? server.config,
      scope: existing?.scope ?? server.scope,
      tools: existing?.tools ?? server.tools,
      error,
    });

    const servers = this.emitServers();
    this.emit({
      type: "session_update",
      session: {
        mcp_servers: servers.map((entry) => ({ name: entry.name, status: entry.status })),
      } satisfies Partial<SessionState>,
    });

    if (status === "failed") {
      console.warn(`[codex-adapter] MCP server "${name}" startup failed for session ${this.sessionId}: ${error ?? ""}`);
    }
  }

  async handleGetStatus(timeoutMs?: number): Promise<McpServerDetail[]> {
    try {
      const statusEntries = await this.listAllMcpServerStatuses(timeoutMs);
      const configMap = await this.readMcpServersConfig(timeoutMs);

      const names = new Set<string>([
        ...statusEntries.map((s) => s.name),
        ...Object.keys(configMap),
        ...this.mcpStartupStatusByName.keys(),
      ]);

      const statusByName = new Map(statusEntries.map((s) => [s.name, s]));
      const servers: McpServerDetail[] = Array.from(names)
        .sort()
        .map((name) => {
          const status = statusByName.get(name);
          const startupStatus = this.mcpStartupStatusByName.get(name);
          const config = toMcpServerConfig(configMap[name]);
          const enabled = isMcpServerEnabled(configMap[name]);
          const needsSignIn = status?.authStatus === "notLoggedIn";
          const serverStatus: McpServerDetail["status"] = !enabled
            ? "disabled"
            : needsSignIn
              ? "failed"
              : (startupStatus?.status ?? "connected");
          const pluginId = status?.pluginId ?? undefined;

          return {
            name,
            status: serverStatus,
            error: needsSignIn ? "Needs sign-in" : startupStatus?.error,
            // Plugin servers are not in config.toml; show where they connect instead.
            config: !configMap[name] && status?.httpOrigin ? { type: "http", url: status.httpOrigin } : config,
            scope: pluginId ? `plugin ${pluginId}` : "user",
            tools: mapMcpTools(status?.tools),
            ...(needsSignIn ? { needsSignIn } : {}),
          };
        });

      this.mcpServersByName = new Map(servers.map((server) => [server.name, server]));
      for (const server of servers) {
        // A server that no longer asks for a sign-in has finished one, wherever it happened.
        if (!server.needsSignIn && this.signIns.get(server.name)?.state === "failed") this.signIns.delete(server.name);
      }
      this.emitServers();
      this.emit({ type: "session_update", session: { mcp_status_error: null } });
      return servers;
    } catch (err) {
      const message = `Failed to get MCP status: ${err}`;
      console.warn(`[codex-adapter] ${message} for session ${this.sessionId}`);
      this.emit({ type: "session_update", session: { mcp_status_error: message } });
      return [];
    }
  }

  async handleToggle(serverName: string, enabled: boolean): Promise<void> {
    try {
      if (serverName.includes(".")) {
        throw new Error("Server names containing '.' are not supported for toggle");
      }
      await this.transport.call("config/value/write", {
        keyPath: `mcp_servers.${serverName}.enabled`,
        value: enabled,
        mergeStrategy: "upsert",
      });
      await this.reloadMcpServers();
      await this.handleGetStatus();
    } catch (err) {
      const msg = String(err);
      if (msg.includes("invalid transport")) {
        try {
          await this.transport.call("config/value/write", {
            keyPath: `mcp_servers.${serverName}`,
            value: null,
            mergeStrategy: "replace",
          });
          await this.reloadMcpServers();
          await this.handleGetStatus();
          return;
        } catch {}
      }
      this.emit({ type: "error", message: `Failed to toggle MCP server "${serverName}": ${err}` });
    }
  }

  async handleReconnect(): Promise<void> {
    try {
      await this.reloadMcpServers();
      await this.handleGetStatus();
    } catch (err) {
      this.emit({ type: "error", message: `Failed to reload MCP servers: ${err}` });
    }
  }

  async handleReloadAndGetStatus(timeoutMs?: number): Promise<McpServerDetail[]> {
    await this.reloadMcpServers(timeoutMs);
    return this.handleGetStatus(timeoutMs);
  }

  async handleSetServers(servers: Record<string, McpServerConfig>): Promise<void> {
    try {
      const edits: Array<{ keyPath: string; value: Record<string, unknown>; mergeStrategy: "upsert" }> = [];
      for (const [name, config] of Object.entries(servers)) {
        if (name.includes(".")) {
          throw new Error(`Server names containing '.' are not supported: ${name}`);
        }
        edits.push({
          keyPath: `mcp_servers.${name}`,
          value: fromMcpServerConfig(config),
          mergeStrategy: "upsert",
        });
      }
      if (edits.length > 0) {
        await this.transport.call("config/batchWrite", { edits });
      }
      await this.reloadMcpServers();
      await this.handleGetStatus();
    } catch (err) {
      this.emit({ type: "error", message: `Failed to configure MCP servers: ${err}` });
    }
  }

  /** Send every browser the servers with any sign-in in progress. */
  private emitServers(): McpServerDetail[] {
    const servers = Array.from(this.mcpServersByName.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((server) => {
        const signIn = this.signIns.get(server.name);
        if (!signIn) return server;
        const { state, authorizationUrl, error } = signIn;
        return {
          ...server,
          signIn: { state, ...(authorizationUrl ? { authorizationUrl } : {}), ...(error ? { error } : {}) },
        };
      });
    this.emit({ type: "mcp_status", servers });
    return servers;
  }

  private async listAllMcpServerStatuses(timeoutMs?: number): Promise<CodexMcpServerStatus[]> {
    const out: CodexMcpServerStatus[] = [];
    let cursor: string | null = null;
    let page = 0;

    while (page < 50) {
      const response = (await this.transport.call(
        "mcpServerStatus/list",
        {
          cursor,
          limit: 100,
          // A thread's view includes servers its plugins provide.
          threadId: this.session.threadId?.() ?? null,
        },
        timeoutMs,
      )) as CodexMcpStatusListResponse;
      if (Array.isArray(response.data)) {
        out.push(...response.data);
      }
      cursor = typeof response.nextCursor === "string" ? response.nextCursor : null;
      if (!cursor) break;
      page++;
    }

    return out;
  }

  private async readMcpServersConfig(timeoutMs?: number): Promise<Record<string, unknown>> {
    const response = (await this.transport.call("config/read", {}, timeoutMs)) as {
      config?: Record<string, unknown>;
    };
    const config = asRecord(response?.config) || {};
    return asRecord(config.mcp_servers) || {};
  }

  private async reloadMcpServers(timeoutMs?: number): Promise<void> {
    await this.transport.call("config/mcpServer/reload", {}, timeoutMs);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
