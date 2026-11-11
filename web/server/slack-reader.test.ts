import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  parsed: null as Record<string, unknown> | null,
}));
const connect = vi.hoisted(() => vi.fn());
const transportUrls = vi.hoisted(() => [] as { url: string; auth: string }[]);
const claudeRuns = vi.hoisted(() => ({
  calls: [] as string[][],
  onRun: () => {},
  binary: "/bin/claude" as string | null,
}));

vi.mock("node:child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, result: unknown) => void,
  ) => {
    claudeRuns.calls.push([file, ...args]);
    claudeRuns.onRun();
    callback(null, { stdout: "", stderr: "" });
  },
}));
vi.mock("./path-resolver.js", () => ({ resolveBinary: () => claudeRuns.binary }));

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
  claudeRuns.calls = [];
  claudeRuns.onRun = () => {};
  claudeRuns.binary = "/bin/claude";
});

function slackLogin(accessToken: string, expiresAt: number) {
  return { mcpOAuth: { "slack|1": { serverUrl: "https://mcp.slack.com/mcp", accessToken, expiresAt } } };
}

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

  it("has Claude Code renew an expired login with `claude mcp list`, then uses the renewed one", async () => {
    // Takode never refreshes the token itself; Claude Code's health check does,
    // and writes the new token to its own store, which Takode then reads.
    store.parsed = slackLogin("old", Date.now() + 30_000);
    claudeRuns.onRun = () => {
      store.parsed = slackLogin("renewed", Date.now() + 12 * HOUR);
    };
    const opened = await openClaudeSlackReader();
    expect(claudeRuns.calls).toEqual([["/bin/claude", "mcp", "list"]]);
    expect(opened.ok).toBe(true);
    expect(transportUrls).toEqual([{ url: "https://mcp.slack.com/mcp", auth: "Bearer renewed" }]);
  });

  it("waits, saying why, when `claude mcp list` does not renew the login", async () => {
    store.parsed = slackLogin("old", Date.now() - HOUR);
    const opened = await openClaudeSlackReader();
    expect(opened).toEqual({ ok: false, reason: expect.stringContaining("did not renew it (it ran)") });
    expect(connect).not.toHaveBeenCalled();

    claudeRuns.binary = null;
    expect(await openClaudeSlackReader()).toEqual({
      ok: false,
      reason: expect.stringContaining("no Claude program found"),
    });
  });

  it("does not run Claude Code while the login is still valid", async () => {
    store.parsed = slackLogin("fresh", Date.now() + HOUR);
    expect((await openClaudeSlackReader()).ok).toBe(true);
    expect(claudeRuns.calls).toEqual([]);
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
