import type { BrowserIncomingMessage, McpServerDetail } from "./session-types.js";
import { mcpOAuthCallbackProblem, mcpOAuthRedirectUri } from "./mcp-oauth-callback.js";

/** One MCP server as Claude Code reports it (`McpServerStatus` of the Agent SDK). */
interface ClaudeMcpServerStatus {
  name: string;
  status: string;
  error?: string;
  scope?: string;
  source?: string;
  config?: { type?: string; url?: string; command?: string; args?: string[] };
  tools?: { name: string; annotations?: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } }[];
}

/**
 * The MCP calls of an Agent SDK query. The sign-in calls exist on the query
 * object but are missing from the SDK's published types, so each is checked
 * before use.
 */
export interface ClaudeMcpQuery {
  mcpServerStatus(): Promise<ClaudeMcpServerStatus[]>;
  reconnectMcpServer(serverName: string): Promise<void>;
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  mcpAuthenticate?: (
    serverName: string,
    redirectUri?: string,
  ) => Promise<{ authUrl?: string; requiresUserAction?: boolean } | undefined>;
  mcpSubmitOAuthCallbackUrl?: (serverName: string, callbackUrl: string) => Promise<unknown>;
}

interface SignIn {
  state: "pending" | "failed";
  authorizationUrl?: string;
  redirectUri?: string;
  error?: string;
}

/** How often a pending sign-in checks whether the browser finished it, and for how long. */
const SIGN_IN_POLL_MS = 3_000;
const SIGN_IN_POLL_LIMIT_MS = 10 * 60_000;

/**
 * MCP status, toggle, reconnect and sign-in for a Claude session, through the
 * Agent SDK. Sign-in state is kept here and sent with every `mcp_status`, so
 * all browsers show the same link.
 *
 * Claude Code finishes a sign-in itself when the browser reaches its loopback
 * callback (a desktop on the session's machine), and the server connects on
 * its own; a pending sign-in polls status to notice that. A browser elsewhere
 * pastes the callback address, which goes to Claude Code over the SDK; the
 * server then needs a reconnect before it connects.
 */
export class ClaudeMcpManager {
  private servers: McpServerDetail[] = [];
  private signIns = new Map<string, SignIn>();
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private statusError: string | null | undefined;

  constructor(
    private readonly query: () => ClaudeMcpQuery | null,
    private readonly emit: (msg: BrowserIncomingMessage) => void,
    private readonly sessionId: string,
  ) {}

  /** Servers Claude listed at startup, shown until the first status answer. */
  seed(servers: { name: string; status: string }[]): void {
    this.servers = servers.map((server) => toDetail({ name: server.name, status: server.status }));
  }

  async handleGetStatus(): Promise<McpServerDetail[]> {
    const query = this.query();
    if (query) {
      try {
        this.servers = (await query.mcpServerStatus()).map(toDetail);
        for (const server of this.servers) {
          if (!server.needsSignIn) this.endSignIn(server.name);
        }
        this.setStatusError(null);
      } catch (err) {
        const message = `Failed to get MCP status: ${errorText(err)}`;
        console.warn(`[claude-sdk-adapter] ${message} for session ${this.sessionId}`);
        this.setStatusError(message);
      }
    }
    return this.emitServers();
  }

  async handleToggle(serverName: string, enabled: boolean): Promise<void> {
    await this.control(`Failed to ${enabled ? "enable" : "disable"} MCP server "${serverName}"`, (query) =>
      query.toggleMcpServer(serverName, enabled),
    );
  }

  async handleReconnect(serverName: string): Promise<void> {
    await this.control(`Failed to reconnect MCP server "${serverName}"`, (query) =>
      query.reconnectMcpServer(serverName),
    );
  }

  async handleSignIn(serverName: string): Promise<void> {
    const query = this.query();
    if (!query?.mcpAuthenticate || !query.mcpSubmitOAuthCallbackUrl) {
      this.emit({
        type: "error",
        message: `This Claude Code version can't sign in to MCP servers from Takode. Run claude in a terminal on the session's machine and use /mcp to sign in to "${serverName}", then reconnect it here.`,
      });
      return;
    }
    try {
      const response = await query.mcpAuthenticate(serverName);
      const authorizationUrl = response?.authUrl;
      if (response?.requiresUserAction === false || !authorizationUrl) {
        // Already signed in (for example with a token the server accepts): just connect.
        this.endSignIn(serverName);
        await this.handleReconnect(serverName);
        return;
      }
      this.signIns.set(serverName, {
        state: "pending",
        authorizationUrl,
        redirectUri: mcpOAuthRedirectUri(authorizationUrl),
      });
      this.pollSignIn(serverName);
    } catch (err) {
      this.signIns.set(serverName, { state: "failed", error: `Couldn't start the sign-in: ${errorText(err)}` });
    }
    this.emitServers();
  }

  /** Finish a sign-in with the address a browser on another device could not open. */
  async handleSignInCallback(serverName: string, callbackUrl: string): Promise<void> {
    const signIn = this.signIns.get(serverName);
    const query = this.query();
    if (signIn?.state !== "pending" || !query?.mcpSubmitOAuthCallbackUrl) {
      this.emit({ type: "error", message: `No sign-in to "${serverName}" is waiting. Start it again.` });
      return;
    }
    const problem = mcpOAuthCallbackProblem(callbackUrl, signIn.redirectUri);
    if (problem) {
      this.emit({ type: "error", message: problem });
      return;
    }
    try {
      await query.mcpSubmitOAuthCallbackUrl(serverName, callbackUrl.trim());
      // Claude Code stores the token but leaves the server waiting until it reconnects.
      await query.reconnectMcpServer(serverName);
    } catch (err) {
      this.signIns.set(serverName, { state: "failed", error: `Sign-in failed: ${errorText(err)}` });
      this.stopPolling(serverName);
    }
    await this.handleGetStatus();
  }

  /** Stop background checks (the session is closing). */
  dispose(): void {
    for (const name of [...this.pollTimers.keys()]) this.stopPolling(name);
  }

  /** Report a status failure or its recovery once, not on every sign-in poll. */
  private setStatusError(message: string | null): void {
    if (this.statusError === message) return;
    this.statusError = message;
    this.emit({ type: "session_update", session: { mcp_status_error: message } });
  }

  private pollSignIn(serverName: string): void {
    this.stopPolling(serverName);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > SIGN_IN_POLL_LIMIT_MS) {
        this.stopPolling(serverName);
        return;
      }
      void this.handleGetStatus();
    }, SIGN_IN_POLL_MS);
    this.pollTimers.set(serverName, timer);
  }

  private stopPolling(serverName: string): void {
    const timer = this.pollTimers.get(serverName);
    if (timer) clearInterval(timer);
    this.pollTimers.delete(serverName);
  }

  private endSignIn(serverName: string): void {
    this.signIns.delete(serverName);
    this.stopPolling(serverName);
  }

  private async control(failure: string, action: (query: ClaudeMcpQuery) => Promise<void>): Promise<void> {
    const query = this.query();
    if (!query) return;
    try {
      await action(query);
    } catch (err) {
      this.emit({ type: "error", message: `${failure}: ${errorText(err)}` });
    }
    await this.handleGetStatus();
  }

  private emitServers(): McpServerDetail[] {
    const servers = this.servers.map((server) => {
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
}

function toDetail(server: ClaudeMcpServerStatus): McpServerDetail {
  const needsSignIn = server.status === "needs-auth";
  const status: McpServerDetail["status"] =
    server.status === "connected"
      ? "connected"
      : server.status === "disabled"
        ? "disabled"
        : server.status === "pending"
          ? "connecting"
          : "failed";
  const config = server.config ?? {};
  return {
    name: server.name,
    status,
    ...(needsSignIn ? { needsSignIn, error: "Needs sign-in" } : server.error ? { error: server.error } : {}),
    config: {
      type: config.type ?? (config.url ? "http" : config.command ? "stdio" : "unknown"),
      ...(config.url ? { url: config.url } : {}),
      ...(config.command ? { command: config.command } : {}),
      ...(config.args ? { args: config.args } : {}),
    },
    scope: server.source === "plugin" ? "plugin" : (server.scope ?? "user"),
    tools: (server.tools ?? []).map((tool) => ({ name: tool.name, annotations: tool.annotations })),
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
