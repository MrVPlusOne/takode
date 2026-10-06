import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, ContentBlock } from "./session-types.js";
import { buildSessionActivityPreview } from "./session-activity-preview.js";
import { registerSessionActivityPreviewRoute } from "./routes/session-activity-preview-route.js";

function assistant(
  id: string,
  content: ContentBlock[],
  timestamp: number,
  parentToolUseId: string | null = null,
): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude",
      content,
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: parentToolUseId,
    timestamp,
  };
}

function tool(id: string, name: string, input: Record<string, unknown>): ContentBlock {
  return { type: "tool_use", id, name, input };
}

describe("buildSessionActivityPreview", () => {
  it("returns the newest own actions oldest-first with deep-link indices", () => {
    // The preview is a tail slice: older actions fall off once the line limit is reached.
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", content: "start", timestamp: 1 },
      assistant("a1", [tool("t1", "Read", { file_path: "/repo/old.ts" })], 2),
      assistant("a2", [{ type: "text", text: "\n\nLooking at the layout.\nSecond line is dropped." }], 3),
      assistant("a3", [tool("t2", "Bash", { command: "bun test", description: "Run focused tests" })], 4),
      assistant("a4", [tool("t3", "Edit", { file_path: "/repo/web/src/App.tsx" })], 5),
      assistant("a5", [tool("t4", "Grep", { pattern: "WaitingWorker" })], 6),
    ];

    expect(buildSessionActivityPreview(history)).toEqual({
      lines: [
        { historyIndex: 2, kind: "message", text: "Looking at the layout.", timestamp: 3 },
        { historyIndex: 3, kind: "tool", toolName: "Bash", text: "Run focused tests", timestamp: 4 },
        { historyIndex: 4, kind: "tool", toolName: "Edit", text: "App.tsx", timestamp: 5 },
        { historyIndex: 5, kind: "tool", toolName: "Grep", text: "WaitingWorker", timestamp: 6 },
      ],
      lastActivityAt: 6,
    });
  });

  it("skips subagent-internal messages and duplicate replayed blocks", () => {
    // Subagent children are not the worker's own actions; replayed tool/text blocks
    // with the same identity must not appear twice in a four-line peek.
    const history: BrowserIncomingMessage[] = [
      assistant("a1", [{ type: "text", text: "Plan ready" }, tool("t1", "Task", { description: "Explore" })], 1),
      assistant("child", [tool("c1", "Read", { file_path: "/repo/child.ts" })], 2, "t1"),
      assistant("a1", [{ type: "text", text: "Plan ready" }, tool("t1", "Task", { description: "Explore" })], 3),
    ];

    const preview = buildSessionActivityPreview(history);
    expect(preview.lines.map((line) => line.text)).toEqual(["Plan ready", "Explore"]);
    expect(preview.lastActivityAt).toBe(3);
  });

  it("reports an empty preview for histories without assistant activity", () => {
    expect(buildSessionActivityPreview([])).toEqual({ lines: [], lastActivityAt: null });
  });
});

describe("GET /sessions/:id/activity-preview", () => {
  function makeApi(history: BrowserIncomingMessage[] | null) {
    const api = new Hono();
    registerSessionActivityPreviewRoute(api, {
      wsBridge: { getSession: vi.fn(() => (history ? { messageHistory: history } : undefined)) } as any,
      resolveId: (raw) => (raw === "worker" || raw === "7" ? "worker" : null),
    });
    return api;
  }

  it("serves the bounded preview for a session number or id", async () => {
    const api = makeApi([assistant("a1", [tool("t1", "Read", { file_path: "/repo/a.ts" })], 9)]);
    const res = await api.request("/sessions/7/activity-preview");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lines: [{ historyIndex: 0, kind: "tool", toolName: "Read", text: "a.ts", timestamp: 9 }],
      lastActivityAt: 9,
    });
  });

  it("returns 404 for unknown sessions", async () => {
    expect((await makeApi([]).request("/sessions/missing/activity-preview")).status).toBe(404);
    expect((await makeApi(null).request("/sessions/worker/activity-preview")).status).toBe(404);
  });
});
