import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  parsed: null as Record<string, unknown> | null,
}));
const connect = vi.hoisted(() => vi.fn());
const transportUrls = vi.hoisted(() => [] as { url: string; auth: string }[]);
/** What Slack's MCP tools answer, by call, and the calls made. */
const slackTools = vi.hoisted(() => ({
  calls: [] as { name: string; arguments: Record<string, unknown> }[],
  respond: (_call: { name: string; arguments: Record<string, unknown> }): unknown => ({ content: [] }),
}));
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
    callTool = vi.fn(async (call: { name: string; arguments: Record<string, unknown> }) => {
      slackTools.calls.push(call);
      return slackTools.respond(call);
    });
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
  slackTools.calls = [];
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

describe("readThreadReplies", () => {
  /** One page of a detailed search result, as the MCP tool returns it. */
  function searchPage(results: { ts: string; threadTs: string }[], cursor: string | null) {
    const text = results
      .map(
        (r, i) =>
          `### Result ${i + 1} of ${results.length}\nFrom: Wenxu Mao (ID: U1) \nTime: 15:44 PST\nMessage_ts: ${r.ts}\n` +
          `Permalink: [link](https://acme.slack.com/archives/C7/p1?thread_ts=${r.threadTs}&cid=C7)\nText: \nreply ${r.ts}\n\n---\n`,
      )
      .join("\n");
    const pagination = cursor ? `For the next page of results use cursor \`${cursor}\`\n` : "End of results\n";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ results: text, pagination_info: pagination }),
        },
      ],
    };
  }

  async function connection() {
    store.parsed = slackLogin("fresh", Date.now() + HOUR);
    const opened = await openClaudeSlackReader();
    if (!opened.ok) throw new Error(opened.reason);
    return opened.connection;
  }

  it("searches the conversation's threads page by page and keeps only replies", async () => {
    slackTools.respond = (call) =>
      call.arguments.cursor
        ? searchPage([{ ts: "30.000001", threadTs: "10.000001" }], null)
        : searchPage(
            [
              // The message that started the thread names itself; it is no reply.
              { ts: "10.000001", threadTs: "10.000001" },
              { ts: "20.000001", threadTs: "10.000001" },
            ],
            "page-2",
          );
    const found = await (await connection()).readThreadReplies("C7", "5.000000");
    expect(found.readTo).toBeUndefined();
    expect(found.replies.map((r) => [r.ts, r.threadTs])).toEqual([
      ["20.000001", "10.000001"],
      ["30.000001", "10.000001"],
    ]);
    expect(slackTools.calls[0]).toEqual({
      name: "slack_search_public_and_private",
      arguments: expect.objectContaining({
        filters: "in:<#C7> is:thread",
        after: "5",
        sort: "timestamp",
        sort_dir: "asc",
      }),
    });
    expect(slackTools.calls[1]!.arguments.cursor).toBe("page-2");
  });

  it("stops after five pages and says how far it read", async () => {
    // Messages that started threads count too: pages of them alone still move the search on.
    let page = 0;
    slackTools.respond = () => {
      page++;
      return searchPage([{ ts: `${page}0.000001`, threadTs: `${page}0.000001` }], "more");
    };
    const found = await (await connection()).readThreadReplies("C7", "5.000000");
    expect(found).toEqual({ replies: [], readTo: "50.000001" });
    expect(slackTools.calls).toHaveLength(5);
  });
});
