import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { readClaudeCredentialStore } from "./claude-credentials.js";
import { resolveBinary } from "./path-resolver.js";
import { machineSettingsFor } from "./remote-host/machine-settings.js";
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
/** `claude mcp list` checks every MCP server Claude Code has; it normally takes a second or two. */
const RENEWAL_TIMEOUT_MS = 60_000;
const execFilePromise = promisify(execFile);

interface McpOAuthEntry {
  serverUrl?: string;
  accessToken?: string;
  expiresAt?: number;
}

/**
 * Connect to Slack's MCP server with the Slack login Claude Code keeps on this
 * machine. Its scopes only read (history, search, users), so nothing sent
 * through it can post. Takode never refreshes or rewrites that login itself:
 * Slack rotates refresh tokens, and a second refresher would break Claude
 * Code's copy. When the token has expired, Takode runs `claude mcp list`,
 * whose health check makes Claude Code renew its own logins the way a session
 * does, and reads the login again; if it is still expired, reads wait until a
 * Claude session uses Slack.
 */
export const openClaudeSlackReader: OpenSlackReader = async () => {
  let login = await readSlackLogin();
  if (!login) return { ok: false, reason: "Claude Code on this machine has no Slack login" };
  if (isExpired(login)) {
    const renewal = await renewClaudeLogins();
    login = await readSlackLogin();
    if (!login || isExpired(login)) {
      return {
        ok: false,
        reason: `Claude Code's Slack login has expired and \`claude mcp list\` did not renew it (${renewal}); waiting for a Claude session to use Slack`,
      };
    }
    console.log("[slack-updates] Claude Code renewed its expired Slack login through `claude mcp list`");
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

async function readSlackLogin(): Promise<McpOAuthEntry | undefined> {
  const store = await readClaudeCredentialStore();
  const logins = Object.values((store?.parsed.mcpOAuth as Record<string, McpOAuthEntry> | undefined) ?? {}).filter(
    (entry) => entry.accessToken && isSlackMcpUrl(entry.serverUrl),
  );
  return logins.sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0))[0];
}

function isExpired(login: McpOAuthEntry): boolean {
  return login.expiresAt !== undefined && login.expiresAt - EXPIRY_MARGIN_MS <= Date.now();
}

/** Run `claude mcp list` with this machine's Claude program; says how it went. */
async function renewClaudeLogins(): Promise<string> {
  const binary = resolveBinary(machineSettingsFor(null).claudeBinary || "claude");
  if (!binary) return "no Claude program found";
  try {
    await execFilePromise(binary, ["mcp", "list"], { cwd: homedir(), timeout: RENEWAL_TIMEOUT_MS });
    return "it ran";
  } catch (error) {
    return `it failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function isSlackMcpUrl(url: string | undefined): boolean {
  try {
    return url !== undefined && new URL(url).hostname === SLACK_MCP_HOST;
  } catch {
    return false;
  }
}
