import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ModelProvenanceMigration } from "../model-identity-contract.js";
import { registerSessionModelProvenanceMigrationRoute } from "./session-model-provenance-migration-route.js";

function migration(eventId: string, migratedAt = 123): ModelProvenanceMigration {
  return {
    eventId,
    code: "model_provenance_unavailable",
    source: "legacy_parent",
    selectedModel: "gpt-5.6-sol",
    authority: {
      model: "gpt-5.6-sol",
      source: "session_default",
      policyVersion: "test",
      overrideTrace: [{ model: "gpt-5.6-sol", source: "session_default", precedence: 300, status: "selected" }],
    },
    migratedAt,
    warning: `Original provenance unavailable at ${migratedAt}`,
  };
}

function makeRoute(currentEventId = "shared-event") {
  const shared = migration("shared-event");
  const sessions = [
    {
      sessionId: "parent",
      modelProvenanceMigration: currentEventId === "shared-event" ? shared : migration(currentEventId),
    },
    { sessionId: "child", modelProvenanceMigration: { ...shared } },
    { sessionId: "newer", modelProvenanceMigration: migration("new-event", 456) },
  ];
  const bridgeSessions = new Map(
    sessions.map((session) => [
      session.sessionId,
      { id: session.sessionId, state: { modelProvenanceMigration: session.modelProvenanceMigration } },
    ]),
  );
  const acknowledgements = new Map<string, number>();
  const store = {
    acknowledge: vi.fn(async (eventId: string) => {
      const acknowledgedAt = acknowledgements.get(eventId) ?? 999;
      acknowledgements.set(eventId, acknowledgedAt);
      return acknowledgedAt;
    }),
    getAcknowledgedAt: (eventId: string) => acknowledgements.get(eventId),
  };
  const broadcastToSession = vi.fn();
  const broadcastGlobal = vi.fn();
  const app = new Hono();
  registerSessionModelProvenanceMigrationRoute(app, {
    launcher: {
      getSession: (id: string) => sessions.find((session) => session.sessionId === id),
      listSessions: () => sessions,
    },
    wsBridge: {
      getSession: (id: string) => bridgeSessions.get(id),
      broadcastToSession,
      broadcastGlobal,
    },
    resolveId: (raw: string) => (bridgeSessions.has(raw) ? raw : null),
    modelProvenanceMigrationAcknowledgementStore: store,
  } as any);
  return { app, sessions, bridgeSessions, store, broadcastToSession, broadcastGlobal };
}

describe("model provenance migration acknowledgement route", () => {
  it("durably acknowledges and projects the exact event family without deleting audit provenance", async () => {
    // The sidecar write completes before either direct-session or global browser projection is emitted.
    const { app, sessions, bridgeSessions, store, broadcastToSession, broadcastGlobal } = makeRoute();
    const response = await app.request("/sessions/parent/model-provenance-migration/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: "shared-event" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      eventId: "shared-event",
      acknowledgedAt: 999,
      affectedSessionIds: ["parent", "child"],
    });
    expect(store.acknowledge).toHaveBeenCalledWith("shared-event");
    expect(sessions[0].modelProvenanceMigration).toMatchObject({
      eventId: "shared-event",
      selectedModel: "gpt-5.6-sol",
      migratedAt: 123,
      warning: "Original provenance unavailable at 123",
      acknowledgedAt: 999,
    });
    expect(bridgeSessions.get("child")?.state.modelProvenanceMigration.acknowledgedAt).toBe(999);
    expect(sessions[2].modelProvenanceMigration.acknowledgedAt).toBeUndefined();
    expect(broadcastToSession).toHaveBeenCalledTimes(2);
    expect(broadcastGlobal).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale event action before persistence or broadcast", async () => {
    // A delayed click from an older rendered notice must not acknowledge the newer event now attached to the session.
    const { app, store, broadcastToSession, broadcastGlobal } = makeRoute("new-event");
    const response = await app.request("/sessions/parent/model-provenance-migration/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: "shared-event" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "migration_event_changed", currentEventId: "new-event" });
    expect(store.acknowledge).not.toHaveBeenCalled();
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastGlobal).not.toHaveBeenCalled();
  });
});
