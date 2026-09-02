import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { QuestInProgress } from "../quest-types.js";
import { appendQuestOutcomeRevision, type QuestOutcomeRevisionInput } from "../quest-outcome.js";
import type { RouteContext } from "./context.js";

const store = vi.hoisted(() => ({
  getQuest: vi.fn(),
  updateQuestOutcome: vi.fn(),
}));

vi.mock("../quest-store.js", () => store);

import { createQuestOutcomeRoutes } from "./quest-outcome-routes.js";

function assistant(id: string, text: string, threadKey = "main"): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      model: "test",
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 1,
    ...(threadKey !== "main"
      ? {
          threadKey,
          questId: threadKey,
          threadRefs: [{ threadKey, questId: threadKey, source: "explicit" as const }],
        }
      : { threadKey: "main" }),
  };
}

function quest(): QuestInProgress {
  return {
    id: "q-42",
    questId: "q-42",
    version: 2,
    title: "Outcome route",
    description: "Test",
    status: "in_progress",
    sessionId: "worker",
    claimedAt: 1,
    createdAt: 1,
    leaderSessionId: "leader",
  };
}

function routeContext(
  history: BrowserIncomingMessage[],
  auth: ReturnType<RouteContext["authenticateCompanionCallerOptional"]> = null,
): RouteContext {
  const leaderInfo = { sessionId: "leader", sessionNum: 49, isOrchestrator: true, name: "Leader" } as any;
  return {
    launcher: {
      getSession: (id: string) => (id === "leader" ? leaderInfo : undefined),
    },
    wsBridge: {
      getSession: (id: string) => (id === "leader" ? { messageHistory: history } : undefined),
      broadcastGlobal: vi.fn(),
    },
    resolveId: (raw: string) => (raw === "leader" || raw === "49" ? "leader" : null),
    authenticateCompanionCallerOptional: () => auth,
  } as unknown as RouteContext;
}

async function putOutcome(ctx: RouteContext, body: Record<string, unknown>) {
  const app = new Hono();
  app.route("/api", createQuestOutcomeRoutes(ctx));
  return app.request("/api/quests/q-42/outcome", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Quest Outcome routes", () => {
  beforeEach(() => {
    store.getQuest.mockReset().mockResolvedValue(quest());
    store.updateQuestOutcome
      .mockReset()
      .mockImplementation(async (_questId: string, input: QuestOutcomeRevisionInput) => ({
        ...quest(),
        outcome: {
          currentRevisionId: "r1",
          revisions: [
            {
              revisionId: "r1",
              markdown: input.markdown,
              summaryMarkdown: "summary",
              summarySource: "derived",
              contentHash: "hash",
              createdAt: 2,
              actor: input.actor,
              anchor: input.anchor,
              sources: input.sources,
            },
          ],
        },
      }));
  });

  it("imports exact routed leader prose, strips hidden directives, and records its boundary", async () => {
    const response = await putOutcome(
      routeContext([assistant("a1", "## Result\n\nUseful result.\n\n{[(Quest Quiz: q-42)]}", "q-42")]),
      {
        baseRevisionId: null,
        mode: "replace",
        source: { sessionId: "leader", messageId: "a1", historyIndex: 0 },
      },
    );

    expect(response.status).toBe(200);
    const input = store.updateQuestOutcome.mock.calls[0]?.[1] as QuestOutcomeRevisionInput;
    expect(input.markdown).toBe("## Result\n\nUseful result.");
    expect(input.anchor).toEqual({ sessionId: "leader", historyIndex: 0, messageId: "a1" });
    expect(input.sources[0]).toMatchObject({
      kind: "message",
      targetQuestId: "q-42",
      sourceThreadKeys: ["q-42"],
    });
  });

  it("allows an audited direct-human Main-only copy with its exact chronological boundary", async () => {
    const response = await putOutcome(
      routeContext([assistant("q1", "Earlier quest result", "q-42"), assistant("main1", "Useful Main-only prose")]),
      {
        baseRevisionId: null,
        source: { sessionId: "leader", messageId: "main1", historyIndex: 1 },
      },
    );

    expect(response.status).toBe(200);
    const input = store.updateQuestOutcome.mock.calls[0]?.[1] as QuestOutcomeRevisionInput;
    expect(input.anchor).toEqual({ sessionId: "leader", historyIndex: 1, messageId: "main1" });
    expect(input.sources[0]).toMatchObject({ kind: "message", crossDestinationCopy: true, targetQuestId: "q-42" });
  });

  it("returns the original success for an exact append retry without appending twice", async () => {
    let stored = appendQuestOutcomeRevision(
      quest(),
      {
        baseRevisionId: null,
        markdown: "Earlier result.",
        actor: { kind: "human" },
        sources: [{ kind: "manual", targetQuestId: "q-42", contentHash: "earlier" }],
      },
      { now: 1, revisionId: "r1" },
    );
    store.getQuest.mockImplementation(async () => stored);
    store.updateQuestOutcome.mockImplementation(async (_questId: string, input: QuestOutcomeRevisionInput) => {
      stored = appendQuestOutcomeRevision(stored, input, { now: 2, revisionId: "r2" });
      return stored;
    });
    const context = routeContext([assistant("a2", "Added result.", "q-42")]);
    const body = {
      baseRevisionId: "r1",
      mode: "append",
      source: { sessionId: "leader", messageId: "a2", historyIndex: 0 },
      idempotencyKey: "append-once",
    };

    const first = await putOutcome(context, body);
    const retry = await putOutcome(context, body);

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(store.updateQuestOutcome).toHaveBeenCalledTimes(1);
    expect(stored.outcome?.revisions).toHaveLength(2);
    expect(stored.outcome?.revisions.at(-1)?.markdown).toBe("Earlier result.\n\nAdded result.");
  });

  it("rejects importing content authoritatively routed to another quest", async () => {
    const response = await putOutcome(routeContext([assistant("other", "Other quest result", "q-99")]), {
      baseRevisionId: null,
      source: { sessionId: "leader", messageId: "other", historyIndex: 0 },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("another quest") });
    expect(store.updateQuestOutcome).not.toHaveBeenCalled();
  });

  it("allows only the direct user or exact recorded leader to publish", async () => {
    const history = [assistant("a1", "Quest result", "q-42")];
    const denied = await putOutcome(
      routeContext(history, { callerId: "worker", caller: { sessionId: "worker", isOrchestrator: false } } as any),
      { baseRevisionId: null, source: { sessionId: "leader", messageId: "a1", historyIndex: 0 } },
    );
    expect(denied.status).toBe(403);

    const allowed = await putOutcome(
      routeContext(history, {
        callerId: "leader",
        caller: { sessionId: "leader", sessionNum: 49, isOrchestrator: true, name: "Leader" },
      } as any),
      { baseRevisionId: null, source: { sessionId: "leader", messageId: "a1", historyIndex: 0 } },
    );
    expect(allowed.status).toBe(200);
    expect((store.updateQuestOutcome.mock.calls.at(-1)?.[1] as QuestOutcomeRevisionInput).actor).toMatchObject({
      kind: "leader",
      sessionId: "leader",
      sessionNum: 49,
    });
  });
  it("rejects inferred route ownership instead of silently treating it as an explicit target", async () => {
    const inferred = assistant("inferred", "Inferred quest result", "q-42") as Extract<
      BrowserIncomingMessage,
      { type: "assistant" }
    >;
    inferred.threadRefs = [{ threadKey: "q-42", questId: "q-42", source: "inferred" }];
    const response = await putOutcome(routeContext([inferred]), {
      baseRevisionId: null,
      source: { sessionId: "leader", messageId: "inferred", historyIndex: 0 },
    });

    expect(response.status).toBe(400);
    expect(store.updateQuestOutcome).not.toHaveBeenCalled();
  });
});
