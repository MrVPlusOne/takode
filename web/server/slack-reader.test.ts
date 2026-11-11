import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  parsed: null as Record<string, unknown> | null,
}));
const connect = vi.hoisted(() => vi.fn());
const transportUrls = vi.hoisted(() => [] as { url: string; auth: string }[]);

vi.mock("./claude-credentials.js", () => ({
  readClaudeCredentialStore: async () => (store.parsed ? { raw: "", parsed: store.parsed } : null),
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = connect;
    callTool = vi.fn();
    close = vi.fn(async () => {});
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: { requestInit: { headers: { Authorization: string } } }) {
      transportUrls.push({
        url: url.href,
        auth: options.requestInit.headers.Authorization,
      });
    }
  },
}));

import { openClaudeSlackReader } from "./slack-reader.js";

const HOUR = 60 * 60_000;

beforeEach(() => {
  store.parsed = null;
  connect.mockReset();
  transportUrls.length = 0;
});

describe("openClaudeSlackReader", () => {
  it("says why when Claude Code has no Slack login", async () => {
    // Other MCP logins (WorkIQ here) are not Slack's.
    store.parsed = {
      mcpOAuth: {
        "workiq|1": {
          serverUrl: "https://workiq.example/mcp",
          accessToken: "w",
        },
      },
    };
    expect(await openClaudeSlackReader()).toEqual({
      ok: false,
      reason: "Claude Code on this machine has no Slack login",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("waits instead of using an expired login, and never refreshes it", async () => {
    store.parsed = {
      mcpOAuth: {
        "slack|1": {
          serverUrl: "https://mcp.slack.com/mcp",
          accessToken: "old",
          expiresAt: Date.now() + 30_000,
        },
      },
    };
    const opened = await openClaudeSlackReader();
    expect(opened.ok).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it("connects to Slack's MCP server with the freshest Slack login", async () => {
    store.parsed = {
      mcpOAuth: {
        "slack|old": {
          serverUrl: "https://mcp.slack.com/mcp",
          accessToken: "stale",
          expiresAt: Date.now() + HOUR,
        },
        "slack|new": {
          serverUrl: "https://mcp.slack.com/mcp",
          accessToken: "fresh",
          expiresAt: Date.now() + 5 * HOUR,
        },
      },
    };
    const opened = await openClaudeSlackReader();
    expect(opened.ok).toBe(true);
    expect(transportUrls).toEqual([{ url: "https://mcp.slack.com/mcp", auth: "Bearer fresh" }]);
  });
});
