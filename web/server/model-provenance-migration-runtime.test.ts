import { describe, expect, it, vi } from "vitest";
import type { ModelProvenanceMigration } from "./model-identity-contract.js";
import { projectModelProvenanceMigrationFamilies } from "./model-provenance-migration-runtime.js";

function migration(eventId: string): ModelProvenanceMigration {
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
    migratedAt: 123,
    warning: "Original provenance unavailable",
  };
}

describe("model provenance migration family projection", () => {
  it("hydrates and broadcasts one acknowledgement to every session sharing the event", () => {
    // Parent and child copies are separate persisted records, but event identity makes acknowledgement one family action.
    const shared = migration("shared-event");
    const newer = migration("new-event");
    const infos = [
      { sessionId: "parent", modelProvenanceMigration: shared },
      { sessionId: "child", modelProvenanceMigration: { ...shared } },
      { sessionId: "newer", modelProvenanceMigration: newer },
    ];
    const bridgeSessions = new Map(
      infos.map((info) => [info.sessionId, { state: { modelProvenanceMigration: info.modelProvenanceMigration } }]),
    );
    const broadcastToSession = vi.fn();
    const broadcastGlobal = vi.fn();

    const projected = projectModelProvenanceMigrationFamilies(
      { listSessions: () => infos } as any,
      {
        getSession: (sessionId: string) => bridgeSessions.get(sessionId),
        broadcastToSession,
        broadcastGlobal,
      } as any,
      { getAcknowledgedAt: (eventId: string) => (eventId === "shared-event" ? 456 : undefined) },
      { eventId: "shared-event", broadcast: true },
    );

    expect(projected).toEqual(["parent", "child"]);
    expect(infos[0].modelProvenanceMigration.acknowledgedAt).toBe(456);
    expect(infos[1].modelProvenanceMigration.acknowledgedAt).toBe(456);
    expect(infos[2].modelProvenanceMigration.acknowledgedAt).toBeUndefined();
    expect(bridgeSessions.get("parent")?.state.modelProvenanceMigration.warning).toBe(shared.warning);
    expect(broadcastToSession).toHaveBeenCalledTimes(2);
    expect(broadcastGlobal).toHaveBeenCalledTimes(2);
    expect(broadcastGlobal).toHaveBeenCalledWith({
      type: "session_activity_update",
      session_id: "child",
      session: { modelProvenanceMigration: expect.objectContaining({ eventId: "shared-event", acknowledgedAt: 456 }) },
    });
  });

  it("hydrates restart state without broadcasting or acknowledging a distinct event", () => {
    // Startup hydration must be passive: reconnecting browsers receive restored state later through normal session sync.
    const infos = [
      { sessionId: "restored", modelProvenanceMigration: migration("restored-event") },
      { sessionId: "different", modelProvenanceMigration: migration("different-event") },
    ];
    const bridgeSessions = new Map(
      infos.map((info) => [info.sessionId, { state: { modelProvenanceMigration: info.modelProvenanceMigration } }]),
    );
    const broadcastToSession = vi.fn();
    const broadcastGlobal = vi.fn();

    projectModelProvenanceMigrationFamilies(
      { listSessions: () => infos } as any,
      { getSession: (id: string) => bridgeSessions.get(id), broadcastToSession, broadcastGlobal } as any,
      { getAcknowledgedAt: (eventId: string) => (eventId === "restored-event" ? 789 : undefined) },
    );

    expect(infos[0].modelProvenanceMigration.acknowledgedAt).toBe(789);
    expect(infos[1].modelProvenanceMigration.acknowledgedAt).toBeUndefined();
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastGlobal).not.toHaveBeenCalled();
  });
});
