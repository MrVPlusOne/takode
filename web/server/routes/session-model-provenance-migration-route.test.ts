import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ModelProvenanceMigration } from "../model-identity-contract.js";
import { ModelProvenanceMigrationAcknowledgementStore } from "../model-provenance-migration-acknowledgement-store.js";
import { registerSessionModelProvenanceMigrationRoute } from "./session-model-provenance-migration-route.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

function makeRoute(currentEventId = "shared-event", storeOverride?: unknown) {
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
  const defaultStore = {
    acknowledge: vi.fn(async (eventId: string) => {
      const acknowledgedAt = acknowledgements.get(eventId) ?? 999;
      acknowledgements.set(eventId, acknowledgedAt);
      return acknowledgedAt;
    }),
    getAcknowledgedAt: (eventId: string) => acknowledgements.get(eventId),
  };
  const store = (storeOverride ?? defaultStore) as typeof defaultStore;
  const broadcastToSession = vi.fn();
  const broadcastGlobal = vi.fn();
  const app = new Hono();
  app.onError((error, c) => c.json({ error: error.message }, 500));
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

  it("holds concurrent route responses and projection until one shared write succeeds", async () => {
    // Two browser requests join one route operation and one store write; fanout happens only after commit.
    const gate = deferred();
    const writer = vi.fn(() => gate.promise);
    const store = new ModelProvenanceMigrationAcknowledgementStore("/disposable/acknowledgements.json", writer);
    const { app, sessions, broadcastToSession, broadcastGlobal } = makeRoute("shared-event", store);
    const request = () =>
      app.request("/sessions/parent/model-provenance-migration/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: "shared-event" }),
      });

    const first = request();
    const duplicate = request();
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce());
    expect(store.getAcknowledgedAt("shared-event")).toBeUndefined();
    expect(sessions[0].modelProvenanceMigration.acknowledgedAt).toBeUndefined();
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastGlobal).not.toHaveBeenCalled();

    gate.resolve();
    const responses = await Promise.all([first, duplicate]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(store.getAcknowledgedAt("shared-event")).toBeTypeOf("number");
    expect(broadcastToSession).toHaveBeenCalledTimes(2);
    expect(broadcastGlobal).toHaveBeenCalledTimes(2);
    expect(writer).toHaveBeenCalledOnce();
  });

  it("returns failure to every concurrent route caller without projection when the shared write fails", async () => {
    // A durability error must not create a transient authoritative-hidden browser state.
    const gate = deferred();
    const writer = vi.fn(() => gate.promise);
    const store = new ModelProvenanceMigrationAcknowledgementStore("/disposable/acknowledgements.json", writer);
    const { app, sessions, broadcastToSession, broadcastGlobal } = makeRoute("shared-event", store);
    const request = () =>
      app.request("/sessions/parent/model-provenance-migration/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: "shared-event" }),
      });

    const first = request();
    const duplicate = request();
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce());
    gate.reject(new Error("controlled write failure"));

    const responses = await Promise.all([first, duplicate]);
    expect(responses.map((response) => response.status)).toEqual([500, 500]);
    expect(store.getAcknowledgedAt("shared-event")).toBeUndefined();
    expect(sessions[0].modelProvenanceMigration.acknowledgedAt).toBeUndefined();
    expect(sessions[1].modelProvenanceMigration.acknowledgedAt).toBeUndefined();
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastGlobal).not.toHaveBeenCalled();
    expect(writer).toHaveBeenCalledOnce();
  });
});
