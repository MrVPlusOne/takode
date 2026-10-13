#!/usr/bin/env bun
/**
 * Web search for Claude sessions whose model API is GitHub Copilot.
 *
 * Copilot rejects Claude's own WebSearch tool, but its GPT models can search
 * the web through Copilot's Responses API. Claude starts this MCP server on its
 * own machine when Takode finds the session on Copilot
 * (server/claude-copilot-web-tools.ts), so the search uses the same Copilot
 * address and sign-in as Claude itself.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const execFileAsync = promisify(execFile);

/** The Copilot model that runs searches; `TAKODE_COPILOT_WEB_SEARCH_MODEL` overrides it. */
const DEFAULT_SEARCH_MODEL = "gpt-6-luna";
/**
 * Copilot serves its newer models only to clients it recognizes, and the search
 * runs on behalf of a Claude Code session.
 */
const USER_AGENT = "claude-cli/takode-web-search";
const SEARCH_TIMEOUT_MS = 120_000;

type ToolResponse = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

type ResponsesOutput = Array<{
  type?: string;
  content?: Array<{ text?: string; annotations?: Array<{ url?: string }> }>;
}>;

/**
 * Search the web through Copilot and return the answer with its source URLs.
 *
 * `env` is Claude's environment plus what Takode adds: `TAKODE_COPILOT_BASE_URL`
 * (Claude's Copilot API address) and, when Claude gets its key from a helper
 * command, `TAKODE_COPILOT_API_KEY_HELPER`. Otherwise the key comes from
 * Claude's `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`. Failures come back as
 * an error result rather than an exception, so Claude sees why.
 */
export async function copilotWebSearch(
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ToolResponse> {
  try {
    const baseUrl = env.TAKODE_COPILOT_BASE_URL?.replace(/\/+$/, "");
    if (!baseUrl) return failure("Web search is not set up: no GitHub Copilot address was given.");
    const response = await fetchImpl(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await copilotKey(env)}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({
        model: env.TAKODE_COPILOT_WEB_SEARCH_MODEL || DEFAULT_SEARCH_MODEL,
        tools: [{ type: "web_search" }],
        input: `Search the web for: ${query}\n\nAnswer from what the sources say, and give the URL of every source you used.`,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) return failure(`Web search failed: Copilot answered ${response.status}: ${body}`);
    return { content: [{ type: "text", text: answerText(JSON.parse(body).output ?? []) }] };
  } catch (error) {
    return failure(`Web search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Start the web search MCP server on stdio. */
export async function runWebSearchMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: "takode-web", version: "0.1.0" },
    {
      instructions:
        "This session's Claude runs through GitHub Copilot, which does not support the built-in WebSearch tool. Use web_search to search the web.",
    },
  );
  server.registerTool(
    "web_search",
    {
      title: "Search the web",
      description:
        "Search the web through GitHub Copilot for current information. Returns an answer drawn from the search results, with the URL of every source used. Use this instead of WebSearch, which GitHub Copilot does not support.",
      inputSchema: { query: z.string().min(1).describe("What to search for") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ query }) => copilotWebSearch(query),
  );
  await server.connect(new StdioServerTransport());
}

async function copilotKey(env: NodeJS.ProcessEnv): Promise<string> {
  const helper = env.TAKODE_COPILOT_API_KEY_HELPER;
  // Claude runs its key helper through a shell too.
  if (helper) return (await execFileAsync("/bin/sh", ["-c", helper], { env, timeout: 30_000 })).stdout.trim();
  const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no GitHub Copilot key found in Claude's settings or environment");
  return key;
}

function answerText(output: ResponsesOutput): string {
  const parts: string[] = [];
  const sources = new Set<string>();
  for (const item of output) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.text) parts.push(content.text);
      for (const annotation of content.annotations ?? []) if (annotation.url) sources.add(annotation.url);
    }
  }
  if (sources.size) parts.push(`Sources:\n${[...sources].map((url) => `- ${url}`).join("\n")}`);
  return parts.join("\n\n") || "The search returned no answer.";
}

function failure(text: string): ToolResponse {
  return { content: [{ type: "text", text }], isError: true };
}

if (import.meta.main) {
  await runWebSearchMcpServer();
}
