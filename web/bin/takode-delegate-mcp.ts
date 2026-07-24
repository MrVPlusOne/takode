#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { COMPANION_AUTH_TOKEN_HEADER, COMPANION_SESSION_ID_HEADER } from "../server/routes/auth.js";

type ToolResponse = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

let cachedConfigEnv:
  | {
      codexHome: string;
      env: Record<string, string>;
    }
  | undefined;

function parseTakodeDelegateEnv(configToml: string): Record<string, string> {
  const env: Record<string, string> = {};
  let inDelegateEnv = false;
  for (const rawLine of configToml.split("\n")) {
    const line = rawLine.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      inDelegateEnv = header[1] === "mcp_servers.takode_delegate.env";
      continue;
    }
    if (!inDelegateEnv || !line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[2]) as unknown;
      if (typeof parsed === "string") env[match[1]] = parsed;
    } catch {
      // Ignore malformed values; requiredEnv will report the missing key.
    }
  }
  return env;
}

async function configEnv(): Promise<Record<string, string>> {
  const codexHome = process.env.CODEX_HOME?.trim();
  if (!codexHome) return {};
  if (cachedConfigEnv?.codexHome === codexHome) return cachedConfigEnv.env;
  const configPath = join(codexHome, "config.toml");
  const env = parseTakodeDelegateEnv(await readFile(configPath, "utf-8").catch(() => ""));
  cachedConfigEnv = { codexHome, env };
  return env;
}

async function envValue(name: string): Promise<string | undefined> {
  const value = process.env[name]?.trim();
  if (value) return value;
  const fromConfig = (await configEnv())[name]?.trim();
  if (fromConfig) {
    process.env[name] = fromConfig;
    return fromConfig;
  }
  return undefined;
}

async function requiredEnv(name: string): Promise<string> {
  const value = await envValue(name);
  if (!value) throw new Error(`${name} is required for Takode delegate MCP`);
  return value;
}

export async function callTakode(path: string, body: Record<string, unknown>): Promise<ToolResponse> {
  const port = await requiredEnv("COMPANION_PORT");
  const sessionId = await requiredEnv("COMPANION_SESSION_ID");
  const token = await requiredEnv("COMPANION_AUTH_TOKEN");
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [COMPANION_SESSION_ID_HEADER]: sessionId,
      [COMPANION_AUTH_TOKEN_HEADER]: token,
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
    isError?: boolean;
  };
  const text =
    json.text ?? json.error ?? (response.ok ? "Takode delegate tool completed." : "Takode delegate tool failed.");
  return { content: [{ type: "text", text }], isError: json.isError ?? !response.ok };
}

export async function runTakodeDelegateMcpServer(): Promise<void> {
  const sessionId = await requiredEnv("COMPANION_SESSION_ID");
  const server = new McpServer({
    name: "takode_delegate",
    version: "1.0.0",
  });

  registerTakodeDelegateTools(server, sessionId);

  await server.connect(new StdioServerTransport());
}

export function registerTakodeDelegateTools(server: Pick<McpServer, "registerTool">, sessionId: string): void {
  server.registerTool(
    "delegate_command",
    {
      title: "Delegate command",
      description:
        "Run one shell command in a forked command-delegate copy of this leader session and return a concise summary instead of raw output. If the user asks you to use delegate_command, call this actual MCP tool instead of replying in prose or running the command directly. Hidden delegate children must not call this tool; Takode will reject nested delegation.",
      inputSchema: {
        command: z.string().min(1),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ command }) => callTakode(`/api/sessions/${encodeURIComponent(sessionId)}/delegates/command`, { command }),
  );

  server.registerTool(
    "end_delegation",
    {
      title: "End delegation",
      description:
        "Finish an active delegated command and return a concise summary to the parent leader. This only succeeds from the active hidden delegate child.",
      inputSchema: {
        summary: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ summary }) =>
      callTakode(`/api/sessions/${encodeURIComponent(sessionId)}/delegates/end`, {
        delegateId: await envValue("TAKODE_DELEGATE_ID"),
        parentSessionId: await envValue("TAKODE_DELEGATE_PARENT_SESSION_ID"),
        summary,
      }),
  );
}

if (import.meta.main) {
  await runTakodeDelegateMcpServer();
}
