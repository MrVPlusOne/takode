import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createSessionsRoutes } from "./routes/sessions.js";
import type { BrowserIncomingMessage } from "./session-types.js";

function makeRoute(history: BrowserIncomingMessage[] | null, notifications: Array<Record<string, unknown>> = []) {
  const sessionId = "session-abc";
  const ctx = {
    launcher: {
      getSession: vi.fn(() => ({ sessionId, cwd: "/repo", createdAt: 1 })),
      getSessionNum: vi.fn(() => 123),
    },
    wsBridge: {
      getSession: vi.fn((id: string) =>
        id === sessionId && history ? { id, messageHistory: history, notifications } : null,
      ),
      getToolResult: vi.fn(() => null),
      broadcastToSession: vi.fn(),
      broadcastGlobal: vi.fn(),
      closeSession: vi.fn(),
    },
    sessionStore: {},
    worktreeTracker: {},
    terminalManager: {},
    prPoller: undefined,
    imageStore: undefined,
    timerManager: undefined,
    resolveId: vi.fn((raw: string) => (raw === sessionId || raw === "123" ? sessionId : null)),
    authenticateTakodeCaller: vi.fn(),
    authenticateCompanionCallerOptional: vi.fn(() => null),
    execAsync: vi.fn(),
    execCaptureStdoutAsync: vi.fn(),
    pathExists: vi.fn(async () => false),
    ROUTES_DIR: "/repo/web/server/routes",
    WEB_DIR: "/repo/web",
    buildOrchestratorSystemPrompt: vi.fn(() => ""),
    resolveInitialModeState: vi.fn(() => ({
      permissionMode: "default",
      askPermission: false,
      uiMode: "agent",
    })),
  } as any;

  const app = new Hono();
  app.route("/api", createSessionsRoutes(ctx));
  return app;
}

describe("GET /api/sessions/:id/messages/:idx/preview", () => {
  it("returns a raw history message for browser hover previews without Takode CLI auth", async () => {
    // This validates the browser-facing endpoint used by session-message hover cards.
    // The Takode CLI read route requires auth headers, but markdown hover fetches do not.
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "Start", timestamp: 100 },
      {
        type: "assistant",
        timestamp: 200,
        parent_tool_use_id: null,
        message: {
          id: "a1",
          type: "message",
          role: "assistant",
          model: "claude-test",
          stop_reason: null,
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          content: [{ type: "text", text: "Referenced message body" }],
        },
      },
    ];
    const app = makeRoute(history);

    const res = await app.request("/api/sessions/session-abc/messages/1/preview");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      idx: 1,
      type: "assistant",
      ts: 200,
      content: "Referenced message body",
      rawMessage: {
        type: "assistant",
        message: {
          id: "a1",
          content: [{ type: "text", text: "Referenced message body" }],
        },
      },
    });
  });

  it("uses raw messageHistory indexes when skipped entries precede a visible assistant message", async () => {
    // This mirrors Takode CLI references: msg 2 means raw messageHistory[2],
    // even though messageHistory[1] is not rendered as a ChatMessage.
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", id: "u1", content: "Start", timestamp: 100 },
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "tool-1",
            content: "Hidden tool preview",
            is_error: false,
            total_size: 19,
            is_truncated: false,
          },
        ],
      },
      {
        type: "assistant",
        timestamp: 300,
        parent_tool_use_id: null,
        message: {
          id: "a2",
          type: "message",
          role: "assistant",
          model: "claude-test",
          stop_reason: null,
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          content: [{ type: "text", text: "Agent-readable answer" }],
        },
      },
    ];
    const app = makeRoute(history);

    const res = await app.request("/api/sessions/123/messages/2/preview");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      idx: 2,
      type: "assistant",
      content: "Agent-readable answer",
      rawMessage: {
        type: "assistant",
        message: { id: "a2" },
      },
    });
  });

  it("returns not found for unavailable message indexes", async () => {
    // Keeps genuinely unavailable references on the existing unavailable UI path.
    const app = makeRoute([{ type: "user_message", id: "u1", content: "Only message", timestamp: 100 }]);

    const res = await app.request("/api/sessions/session-abc/messages/9/preview");
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Message index 9 out of range");
  });
});

describe("GET /api/sessions/:id/notifications/:notifId/context", () => {
  it("returns source context from the notification anchor message", async () => {
    // The global needs-input panel uses this route to recover the context
    // paragraph without opening or selecting the target session.
    const history: BrowserIncomingMessage[] = [
      {
        type: "assistant",
        timestamp: 200,
        parent_tool_use_id: null,
        message: {
          id: "a1",
          type: "message",
          role: "assistant",
          model: "claude-test",
          stop_reason: null,
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          content: [{ type: "text", text: "Approval context paragraph.\n\nRisk detail for the decision." }],
        },
      },
    ];
    const app = makeRoute(history, [
      {
        id: "n-1",
        category: "needs-input",
        summary: "Approve candidates?",
        timestamp: 300,
        messageId: "a1",
        done: false,
      },
    ]);

    const res = await app.request("/api/sessions/session-abc/notifications/n-1/context");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      notificationId: "n-1",
      messageId: "a1",
      context: "Approval context paragraph.\n\nRisk detail for the decision.",
    });
  });

  it("returns null context for duplicate fallback prompts", async () => {
    const history: BrowserIncomingMessage[] = [
      {
        type: "leader_user_message",
        id: "fallback-1",
        content: "Needs input: Confirm scope",
        timestamp: 200,
      },
    ];
    const app = makeRoute(history, [
      {
        id: "n-1",
        category: "needs-input",
        summary: "Confirm scope",
        timestamp: 300,
        messageId: "fallback-1",
        done: false,
      },
    ]);

    const res = await app.request("/api/sessions/session-abc/notifications/n-1/context");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.context).toBeNull();
  });
});
