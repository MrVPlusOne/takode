import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  applyCodexNativeSubagentEvent,
  createCodexNativeSubagentRegistry,
  deriveCodexNativeSubagentSnapshot,
} from "../codex-native-subagent-state.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { registerSessionCodexNativeSubagentRoutes } from "./session-codex-native-subagent-routes.js";

const PRIVATE_ROOT_PROVIDER_TURN_ID = "provider-root-turn-PRIVATE-SENTINEL";

function createRegistry(sessionId = "route-session") {
  const registry = createCodexNativeSubagentRegistry(sessionId);
  applyCodexNativeSubagentEvent(
    registry,
    {
      type: "activity",
      kind: "started",
      providerThreadId: "provider-child-private",
      providerEventId: "spawn-1",
      rootProviderTurnId: PRIVATE_ROOT_PROVIDER_TURN_ID,
      agentPath: "/root/route_probe",
      observedAt: 1_787_860_000_000,
    },
    { resolveFeedRootTurnKey: () => "feed-turn-safe" },
  );
  applyCodexNativeSubagentEvent(registry, {
    type: "thread_metadata",
    thread: {
      id: "provider-child-private",
      parentThreadId: "provider-parent-private",
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: "provider-parent-private",
            depth: 1,
            agent_path: "/root/route_probe",
          },
        },
      },
      transcriptAvailability: "partial",
    },
    observedAt: 1_787_860_000_100,
  });
  return registry;
}

function localMessage(childId: string, id: string, text = id): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id: `codex-agent-${id}`,
      type: "message",
      role: "assistant",
      model: "",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 1,
    codexSubagent: { childId, rootTurnId: "feed-turn-safe" },
  };
}

function createApp(session: any) {
  const app = new Hono();
  registerSessionCodexNativeSubagentRoutes(app, {
    resolveId: (id) => (id === "route-session" ? id : null),
    wsBridge: { getSession: (id: string) => (id === "route-session" ? session : undefined) } as never,
  });
  return app;
}

describe("Codex native subagent history route", () => {
  it("pages forward-captured rows with an opaque server cursor", async () => {
    const registry = createRegistry();
    const childId = deriveCodexNativeSubagentSnapshot(registry).children[0]!.childId;
    registry.childrenByProviderThreadId["provider-child-private"]!.transcriptAvailability = "available";
    const session = {
      backendType: "codex",
      codexNativeSubagents: registry,
      codexAdapter: null,
      messageHistory: [localMessage(childId, "m1"), localMessage(childId, "m2"), localMessage(childId, "m3")],
    };
    const app = createApp(session);

    const first = await app.request(
      `/sessions/route-session/codex-native-subagents/${encodeURIComponent(childId)}/history?limit=2`,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.messages.map((message: any) => message.message.content[0].text)).toEqual(["m2", "m3"]);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(firstBody.nextCursor).not.toContain("provider");
    expect(firstBody.coverage).toBe("partial");
    const serializedFirstBody = JSON.stringify(firstBody);
    expect(serializedFirstBody).not.toContain("rootProviderTurnId");
    expect(serializedFirstBody).not.toContain(PRIVATE_ROOT_PROVIDER_TURN_ID);

    const second = await app.request(
      `/sessions/route-session/codex-native-subagents/${encodeURIComponent(childId)}/history?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    );
    const secondBody = await second.json();
    expect(secondBody.messages.map((message: any) => message.message.content[0].text)).toEqual(["m1"]);
    expect(secondBody.nextCursor).toBeNull();
    expect(secondBody.coverage).toBe("partial");
    expect(JSON.stringify(secondBody)).not.toContain("provider-child-private");
  });

  it("transitions opaquely from recent local rows to older provider history without claiming local completeness", async () => {
    const registry = createRegistry();
    const childId = deriveCodexNativeSubagentSnapshot(registry).children[0]!.childId;
    registry.childrenByProviderThreadId["provider-child-private"]!.transcriptAvailability = "available";
    const listTurns = vi.fn(async (threadId: string) =>
      threadId === "provider-parent-private"
        ? { data: [], nextCursor: null }
        : {
            data: [
              {
                id: "older-provider-turn",
                itemsView: "full",
                items: [
                  { type: "agentMessage", id: "recent-local-item", text: "duplicate provider replay" },
                  { type: "agentMessage", id: "older-provider-item", text: "older provider row" },
                ],
              },
            ],
            nextCursor: null,
          },
    );
    const session = {
      backendType: "codex",
      codexNativeSubagents: registry,
      codexAdapter: { getNativeSubagentController: () => ({ listTurns }) },
      messageHistory: [localMessage(childId, "recent-local-item", "recent local row")],
    };
    const app = createApp(session);

    const localResponse = await app.request(
      `/sessions/route-session/codex-native-subagents/${childId}/history?limit=20`,
    );
    const localBody = await localResponse.json();
    expect(localBody.messages[0].message.content[0].text).toBe("recent local row");
    expect(localBody.coverage).toBe("partial");
    expect(localBody.nextCursor).toEqual(expect.any(String));

    const providerResponse = await app.request(
      `/sessions/route-session/codex-native-subagents/${childId}/history?limit=20&cursor=${encodeURIComponent(localBody.nextCursor)}`,
    );
    const providerBody = await providerResponse.json();
    expect(providerBody.messages).toHaveLength(1);
    expect(providerBody.messages[0].message.content[0].text).toBe("older provider row");
    expect(JSON.stringify(providerBody)).not.toContain("duplicate provider replay");
    expect(providerBody.nextCursor).toBeNull();
    expect(JSON.stringify(providerBody)).not.toContain("older-provider-turn");
    expect(JSON.stringify(providerBody)).not.toContain("older-provider-item");
  });

  it("keeps provider paging cursors and thread IDs server-private", async () => {
    const registry = createRegistry();
    const childId = deriveCodexNativeSubagentSnapshot(registry).children[0]!.childId;
    const listTurns = vi.fn(async (threadId: string, options: { cursor?: string | null }) => {
      if (threadId === "provider-parent-private") return { data: [], nextCursor: null };
      if (options.cursor === "raw-provider-cursor-secret") {
        return {
          data: [
            {
              id: "unique-turn-2",
              itemsView: "full",
              items: [{ type: "agentMessage", id: "a2", text: "second page" }],
            },
          ],
          nextCursor: null,
        };
      }
      return {
        data: [
          {
            id: "unique-turn-1",
            itemsView: "full",
            items: [{ type: "agentMessage", id: "a1", text: "first page provider-child-private" }],
          },
        ],
        nextCursor: "raw-provider-cursor-secret",
      };
    });
    const session = {
      backendType: "codex",
      codexNativeSubagents: registry,
      codexAdapter: { getNativeSubagentController: () => ({ listTurns }) },
      messageHistory: [],
    };
    const app = createApp(session);

    const first = await app.request(`/sessions/route-session/codex-native-subagents/${childId}/history?limit=1`);
    const firstBody = await first.json();
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(firstBody.nextCursor).not.toBe("raw-provider-cursor-secret");
    expect(JSON.stringify(firstBody)).not.toContain("provider-child-private");

    const second = await app.request(
      `/sessions/route-session/codex-native-subagents/${childId}/history?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    );
    const secondBody = await second.json();
    expect(secondBody.nextCursor).toBeNull();
    expect(JSON.stringify(secondBody)).toContain("second page");
    expect(listTurns).toHaveBeenCalledWith(
      "provider-child-private",
      expect.objectContaining({ cursor: "raw-provider-cursor-secret" }),
    );
  });

  it("binds opaque cursors to the exact child and consumes them once", async () => {
    const registry = createRegistry();
    applyCodexNativeSubagentEvent(
      registry,
      {
        type: "activity",
        kind: "started",
        providerThreadId: "provider-second-child",
        providerEventId: "spawn-2",
        rootProviderTurnId: "provider-root-turn",
        agentPath: "/root/second_child",
        observedAt: 1_787_860_000_200,
      },
      { resolveFeedRootTurnKey: () => "feed-turn-safe" },
    );
    applyCodexNativeSubagentEvent(registry, {
      type: "thread_metadata",
      thread: {
        id: "provider-second-child",
        parentThreadId: "provider-parent-private",
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "provider-parent-private",
              depth: 1,
              agent_path: "/root/second_child",
            },
          },
        },
      },
      observedAt: 1_787_860_000_300,
    });
    const children = deriveCodexNativeSubagentSnapshot(registry).children;
    const firstChildId = children.find((child) => child.agentPath.endsWith("route_probe"))!.childId;
    const secondChildId = children.find((child) => child.agentPath.endsWith("second_child"))!.childId;
    const session = {
      backendType: "codex",
      codexNativeSubagents: registry,
      codexAdapter: null,
      messageHistory: [
        localMessage(firstChildId, "first-1"),
        localMessage(firstChildId, "first-2"),
        localMessage(secondChildId, "second-1"),
      ],
    };
    const app = createApp(session);
    const first = await app.request(`/sessions/route-session/codex-native-subagents/${firstChildId}/history?limit=1`);
    const cursor = (await first.json()).nextCursor;

    const crossChild = await app.request(
      `/sessions/route-session/codex-native-subagents/${secondChildId}/history?cursor=${encodeURIComponent(cursor)}`,
    );
    expect(crossChild.status).toBe(400);

    const consumed = await app.request(
      `/sessions/route-session/codex-native-subagents/${firstChildId}/history?cursor=${encodeURIComponent(cursor)}`,
    );
    expect(consumed.status).toBe(200);
    const reused = await app.request(
      `/sessions/route-session/codex-native-subagents/${firstChildId}/history?cursor=${encodeURIComponent(cursor)}`,
    );
    expect(reused.status).toBe(400);
  });

  it("rejects unknown opaque child IDs without exposing registry detail", async () => {
    const registry = createRegistry();
    const app = createApp({
      backendType: "codex",
      codexNativeSubagents: registry,
      codexAdapter: null,
      messageHistory: [],
    });
    const response = await app.request("/sessions/route-session/codex-native-subagents/not-a-child/history");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Codex subagent not found" });
  });
});
