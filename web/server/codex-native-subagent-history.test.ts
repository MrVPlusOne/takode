import { describe, expect, it, vi } from "vitest";
import {
  loadProviderCodexNativeSubagentHistoryPage,
  pageForwardCapturedCodexNativeSubagentHistory,
} from "./codex-native-subagent-history.js";
import type { BrowserIncomingMessage } from "./session-types.js";

const ownership = { childId: "codex-child-safe", rootTurnId: "feed-turn-safe" };

function assistant(id: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id: `codex-agent-${id}`,
      type: "message",
      role: "assistant",
      model: "",
      content: [{ type: "text", text: id }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 1,
    codexSubagent: ownership,
  };
}

function providerArgs(
  listTurns: (threadId: string, options: { cursor?: string | null; itemsView?: string }) => Promise<any>,
  overrides: Partial<Parameters<typeof loadProviderCodexNativeSubagentHistoryPage>[0]> = {},
) {
  return {
    client: { listTurns },
    childProviderThreadId: "child",
    ancestorProviderThreadIds: ["parent"],
    ancestorChainComplete: true,
    ownership,
    limit: 20,
    ...overrides,
  };
}

describe("Codex native subagent history", () => {
  it("pages projected forward history from the newest bounded window while preserving chronological order", () => {
    const history = [assistant("m1"), assistant("m2"), assistant("m3"), assistant("m4")];
    const first = pageForwardCapturedCodexNativeSubagentHistory(history, { ownership }, 0, 2);
    const second = pageForwardCapturedCodexNativeSubagentHistory(history, { ownership }, first.nextOffset!, 2);

    const text = (message: BrowserIncomingMessage) =>
      message.type === "assistant" && message.message.content[0]?.type === "text"
        ? message.message.content[0].text
        : null;
    expect(first.messages.map(text)).toEqual(["m3", "m4"]);
    expect(first.nextOffset).toBe(2);
    expect(second.messages.map(text)).toEqual(["m1", "m2"]);
    expect(second.nextOffset).toBeNull();
    expect(first.allMessageIds.size).toBe(4);
  });

  it("projects private adapter ownership through the public browser ownership contract", () => {
    const privateRootProviderTurnId = "provider-root-turn-PRIVATE-SENTINEL";
    const privateOwnership = { ...ownership, rootProviderTurnId: privateRootProviderTurnId };
    const message = assistant("private-ownership") as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    message.codexSubagent = privateOwnership;

    const page = pageForwardCapturedCodexNativeSubagentHistory([message], { ownership: privateOwnership }, 0, 20);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.codexSubagent).toEqual(ownership);
    const serialized = JSON.stringify(page.messages);
    expect(serialized).not.toContain("rootProviderTurnId");
    expect(serialized).not.toContain(privateRootProviderTurnId);
  });

  it("uses one bounded allowlist for forward rows and merges ownership-matched tool result previews", () => {
    const providerThreadId = "019-child-provider-private";
    const providerTurnId = "019-child-turn-private";
    const providerItemId = "call-private-tool-id";
    const absolutePath = "/Users/private/repo/secret.txt";
    const history: BrowserIncomingMessage[] = [
      {
        type: "assistant",
        message: {
          id: `codex-tool_use-${providerItemId}`,
          type: "message",
          role: "assistant",
          model: "",
          content: [
            {
              type: "tool_use",
              id: providerItemId,
              name: "Bash",
              input: {
                command: `cat ${absolutePath} && echo ${providerThreadId} ${providerItemId}`,
                cwd: absolutePath,
                environment: { CODEX_HOME: absolutePath },
                encryptedPayload: "ENCRYPTED INPUT SENTINEL",
              },
            },
          ],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 10,
        codexSubagent: ownership,
      },
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: providerItemId,
            content: `output ${providerTurnId} from ${absolutePath} HOME=${absolutePath}`,
            is_error: false,
            total_size: 999_999,
            is_truncated: true,
          },
        ],
        codexSubagent: ownership,
      },
      {
        type: "codex_reasoning_detail",
        id: "reasoning-private",
        text: `Official summary for ${providerThreadId} reasoning-provider-private`,
        status: "complete",
        timestamp: 11,
        parent_tool_use_id: providerItemId,
        reasoning_turn_id: providerTurnId,
        provider_item_id: "reasoning-provider-private",
        summary_index: 0,
        codexSubagent: ownership,
      },
    ];

    const page = pageForwardCapturedCodexNativeSubagentHistory(
      history,
      {
        ownership,
        sensitiveStrings: [providerThreadId, providerTurnId, absolutePath],
      },
      0,
      20,
    );
    const serialized = JSON.stringify(page.messages);
    expect(serialized).toContain("tool_result");
    expect(serialized).toContain("Official summary");
    expect(serialized).toContain("[sensitive value omitted]");
    expect(serialized).not.toContain(providerThreadId);
    expect(serialized).not.toContain(providerTurnId);
    expect(serialized).not.toContain(providerItemId);
    expect(serialized).not.toContain(absolutePath);
    expect(serialized).not.toContain("reasoning_turn_id");
    expect(serialized).not.toContain("provider_item_id");
    expect(serialized).not.toContain("ENCRYPTED INPUT SENTINEL");
    expect(serialized).not.toContain("CODEX_HOME");
  });

  it("removes credential-shaped fields and path variants from inspector text and tool input", () => {
    const message = assistant("privacy-shapes") as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    message.message.content = [
      {
        type: "text",
        text: "Opened `/etc/passwd`; cwd:/private/tmp/secret/file; OPENAI_API_KEY = sk-text-secret; relative src/app.ts",
      },
      {
        type: "tool_use",
        id: "credential-tool",
        name: "Bash",
        input: {
          command: "cat `/var/db/private-record` && printf src/server.ts",
          OPENAI_API_KEY: "sk-structured-secret",
          AWS_SECRET_ACCESS_KEY: "aws-structured-secret",
          authToken: "bearer-structured-secret",
          password: "password-structured-secret",
          nested: { privateKey: "private-key-sentinel", safeLabel: "retained" },
        },
      },
    ];

    const page = pageForwardCapturedCodexNativeSubagentHistory([message], { ownership }, 0, 20);
    const serialized = JSON.stringify(page.messages);
    for (const forbidden of [
      "/etc/passwd",
      "/private/tmp/secret/file",
      "/var/db/private-record",
      "sk-text-secret",
      "sk-structured-secret",
      "aws-structured-secret",
      "bearer-structured-secret",
      "password-structured-secret",
      "private-key-sentinel",
      "OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "authToken",
      "privateKey",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain("[absolute path omitted]");
    expect(serialized).toContain("src/app.ts");
    expect(serialized).toContain("src/server.ts");
    expect(serialized).toContain('"safeLabel":"retained"');
  });

  it("caps retained text, structured tool input, and tool output per projected record", () => {
    const hugeInput = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [`field_${index}`, "i".repeat(3_000)]),
    );
    const history: BrowserIncomingMessage[] = [
      {
        ...assistant("large-text-item"),
        message: {
          ...(assistant("large-text-item") as Extract<BrowserIncomingMessage, { type: "assistant" }>).message,
          content: [{ type: "text", text: "t".repeat(30_000) }],
        },
      } as BrowserIncomingMessage,
      {
        type: "assistant",
        message: {
          id: "codex-tool_use-large-tool-item",
          type: "message",
          role: "assistant",
          model: "",
          content: [{ type: "tool_use", id: "large-tool-item", name: "Bash", input: hugeInput }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 2,
        codexSubagent: ownership,
      },
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "large-tool-item",
            content: "o".repeat(30_000),
            is_error: false,
            total_size: 30_000,
            is_truncated: true,
          },
        ],
        codexSubagent: ownership,
      },
    ];

    const page = pageForwardCapturedCodexNativeSubagentHistory(history, { ownership }, 0, 20);
    const serialized = JSON.stringify(page.messages);
    expect(serialized).toContain("[tool input omitted: exceeds safety bound]");
    expect(serialized).toContain("…[truncated]");
    expect(serialized.length).toBeLessThan(20_000);
  });

  it("removes a contiguous inherited ancestor prefix and projects only privacy-safe provider content", async () => {
    const childProviderId = "019-child-provider-private";
    const parentProviderId = "019-parent-provider-private";
    const rootProviderId = "019-root-provider-private";
    const listTurns = vi.fn(async (threadId: string, options: { itemsView?: string }) => {
      if (threadId === parentProviderId) {
        return { data: [{ id: "parent-turn", items: [], itemsView: "notLoaded" }], nextCursor: null };
      }
      if (threadId === rootProviderId) {
        return { data: [{ id: "root-turn", items: [], itemsView: "notLoaded" }], nextCursor: null };
      }
      expect(options.itemsView).toBe("full");
      return {
        data: [
          {
            id: "child-unique-turn",
            startedAt: 1_787_860_000,
            completedAt: 1_787_860_010,
            itemsView: "full",
            items: [
              {
                type: "userMessage",
                id: "user-item",
                content: [
                  { type: "text", text: `Inspect ${childProviderId}` },
                  { type: "localImage", path: "/private/image.png" },
                ],
              },
              {
                type: "agentMessage",
                id: "agent-item",
                text: `Safe answer referencing ${parentProviderId}`,
                memoryCitation: { threadId: childProviderId },
              },
              {
                type: "reasoning",
                id: "reasoning-item",
                summary: ["Official summary"],
                content: ["RAW HIDDEN REASONING SENTINEL"],
              },
              {
                type: "commandExecution",
                id: "command-item",
                command: `cat /Users/private/repo && echo ${rootProviderId}`,
                cwd: "/Users/private/repo",
                processId: "pty-secret",
                aggregatedOutput: `output ${parentProviderId} from /private/output.txt`,
                status: "completed",
                exitCode: 0,
              },
              {
                type: "mcpToolCall",
                id: "mcp-item",
                tool: "lookup",
                arguments: {
                  query: "safe",
                  encrypted: "ENCRYPTED PAYLOAD SENTINEL",
                  resourceUri: "file:///private",
                },
                result: { text: "CONNECTOR RESULT SENTINEL" },
                status: "completed",
              },
              { type: "hookPrompt", id: "hook", fragments: [{ text: "SYSTEM PROMPT SENTINEL" }] },
              { type: "imageView", id: "image", path: "/Users/private/image.png" },
            ],
          },
          {
            id: "parent-turn",
            itemsView: "full",
            items: [{ type: "agentMessage", id: "parent-item", text: "INHERITED PARENT PROMPT SENTINEL" }],
          },
          {
            id: "root-turn",
            itemsView: "full",
            items: [{ type: "agentMessage", id: "root-item", text: "INHERITED ROOT PROMPT SENTINEL" }],
          },
        ],
        nextCursor: null,
      };
    });

    const page = await loadProviderCodexNativeSubagentHistoryPage({
      client: { listTurns },
      childProviderThreadId: childProviderId,
      ancestorProviderThreadIds: [parentProviderId, rootProviderId],
      ancestorChainComplete: true,
      ownership,
      limit: 20,
    });

    const serialized = JSON.stringify(page);
    expect(page.messages.length).toBeGreaterThan(0);
    expect(page.messages.every((message) => message.codexSubagent?.childId === ownership.childId)).toBe(true);
    expect(serialized).toContain("Official summary");
    expect(serialized).toContain("[sensitive value omitted]");
    for (const forbidden of [
      childProviderId,
      parentProviderId,
      rootProviderId,
      "RAW HIDDEN REASONING SENTINEL",
      "ENCRYPTED PAYLOAD SENTINEL",
      "SYSTEM PROMPT SENTINEL",
      "INHERITED PARENT PROMPT SENTINEL",
      "INHERITED ROOT PROMPT SENTINEL",
      "/Users/private/repo",
      "/private/output.txt",
      "pty-secret",
      "file:///private",
      "CONNECTOR RESULT SENTINEL",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(page.availability).toBe("available");
    expect(page.coverage).toBe("complete");
  });

  it("fails closed when a matching ancestor turn is not a contiguous leading prefix", async () => {
    const listTurns = vi.fn(async (threadId: string) =>
      threadId === "parent"
        ? { data: [{ id: "inherited" }], nextCursor: null }
        : {
            data: [
              { id: "child-new", itemsView: "full", items: [] },
              { id: "inherited", itemsView: "full", items: [] },
              { id: "child-older", itemsView: "full", items: [] },
            ],
            nextCursor: null,
          },
    );

    const page = await loadProviderCodexNativeSubagentHistoryPage(providerArgs(listTurns));
    expect(page).toMatchObject({
      messages: [],
      nextProviderCursor: null,
      availability: "unavailable",
      coverage: "partial",
    });
  });

  it("carries inherited-prefix proof across provider pages and rejects a later unique turn", async () => {
    const listTurns = vi.fn(async (threadId: string, options: { cursor?: string | null }) => {
      if (threadId === "parent") return { data: [{ id: "p1" }, { id: "p2" }], nextCursor: null };
      if (options.cursor === "older") {
        return { data: [{ id: "child-after-boundary", itemsView: "full", items: [] }], nextCursor: null };
      }
      return {
        data: [
          {
            id: "child-new",
            itemsView: "full",
            items: [{ type: "agentMessage", id: "new-message", text: "new" }],
          },
          { id: "p1", itemsView: "full", items: [] },
        ],
        nextCursor: "older",
      };
    });

    const first = await loadProviderCodexNativeSubagentHistoryPage(providerArgs(listTurns));
    expect(first.nextPrefixState.inheritedPrefixStarted).toBe(true);
    expect(first.nextProviderCursor).toBe("older");
    expect(first.coverage).toBe("partial");

    const second = await loadProviderCodexNativeSubagentHistoryPage(
      providerArgs(listTurns, { cursor: first.nextProviderCursor, prefixState: first.nextPrefixState }),
    );
    expect(second).toMatchObject({ messages: [], availability: "unavailable", coverage: "partial" });
  });

  it("fails closed when bounded ancestor paging cannot prove the full inherited set", async () => {
    const listTurns = vi.fn(async (threadId: string, options: { cursor?: string | null }) =>
      threadId === "parent"
        ? {
            data: Array.from({ length: 50 }, (_, index) => ({ id: `${options.cursor ?? "first"}-${index}` })),
            nextCursor: options.cursor === "same" ? "same" : "same",
          }
        : { data: [{ id: "child-turn", itemsView: "full", items: [] }], nextCursor: null },
    );

    const page = await loadProviderCodexNativeSubagentHistoryPage(providerArgs(listTurns));
    expect(page).toMatchObject({
      messages: [],
      nextProviderCursor: null,
      availability: "partial",
      coverage: "partial",
    });
  });
});
