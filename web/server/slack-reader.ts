import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readClaudeCredentialStore } from "./claude-credentials.js";
import { parseSlackMessages, slackToolResultText, type SlackMessage } from "../shared/slack-updates.js";

/** One open connection to Slack, for one round of reads. */
export interface SlackReadConnection {
  /** Messages in a thread (its first message included) newer than `oldest`. */
  readThread(channelId: string, threadTs: string, oldest: string): Promise<SlackMessage[]>;
  /** Messages in a conversation newer than `oldest`, newest first as Slack prints them. */
  readChannel(channelId: string, oldest: string): Promise<SlackMessage[]>;
  close(): Promise<void>;
}

export type OpenSlackReader = () => Promise<
  { ok: true; connection: SlackReadConnection } | { ok: false; reason: string }
>;

const SLACK_MCP_HOST = "mcp.slack.com";
/** Treat a token this close to expiry as expired, so a read does not fail halfway. */
const EXPIRY_MARGIN_MS = 60_000;

interface McpOAuthEntry {
  serverUrl?: string;
  accessToken?: string;
  expiresAt?: number;
}

/**
 * Connect to Slack's MCP server with the Slack login Claude Code keeps on this
 * machine. Its scopes only read (history, search, users), so nothing sent
 * through it can post. Takode never refreshes or rewrites that login: Slack
 * rotates refresh tokens, and a second refresher would break Claude Code's
 * copy. When the token has expired, reads wait until a Claude session uses
 * Slack and Claude Code refreshes it.
 */
export const openClaudeSlackReader: OpenSlackReader = async () => {
  const store = await readClaudeCredentialStore();
  const logins = Object.values((store?.parsed.mcpOAuth as Record<string, McpOAuthEntry> | undefined) ?? {}).filter(
    (entry) => entry.accessToken && isSlackMcpUrl(entry.serverUrl),
  );
  const login = logins.sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0))[0];
  if (!login)
    return {
      ok: false,
      reason: "Claude Code on this machine has no Slack login",
    };
  if (login.expiresAt !== undefined && login.expiresAt - EXPIRY_MARGIN_MS <= Date.now()) {
    return {
      ok: false,
      reason: "Claude Code's Slack login has expired; waiting for a Claude session to use Slack",
    };
  }
  const client = new Client({ name: "takode-slack-updates", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(login.serverUrl!), {
        requestInit: {
          headers: { Authorization: `Bearer ${login.accessToken}` },
        },
      }),
    );
  } catch (error) {
    return {
      ok: false,
      reason: `Connecting to Slack failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = await client.callTool({ name, arguments: args });
    const text = slackToolResultText(result.content);
    if (result.isError) throw new Error(`${name} failed: ${text}`);
    return text;
  };
  return {
    ok: true,
    connection: {
      readThread: async (channelId, threadTs, oldest) =>
        parseSlackMessages(
          await call("slack_read_thread", {
            channel_id: channelId,
            message_ts: threadTs,
            oldest,
          }),
        ),
      readChannel: async (channelId, oldest) =>
        parseSlackMessages(
          await call("slack_read_channel", {
            channel_id: channelId,
            oldest,
            limit: 100,
          }),
        ),
      close: () => client.close(),
    },
  };
};

function isSlackMcpUrl(url: string | undefined): boolean {
  try {
    return url !== undefined && new URL(url).hostname === SLACK_MCP_HOST;
  } catch {
    return false;
  }
}
