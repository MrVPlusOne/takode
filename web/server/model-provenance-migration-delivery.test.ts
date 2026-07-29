import { describe, expect, it, vi } from "vitest";
import {
  createModelProvenanceMigration,
  resolveUnknownModelProvenanceAuthority,
} from "./cli-launcher-model-authority.js";
import { deliverModelProvenanceMigration } from "./model-provenance-migration-delivery.js";

describe("deliverModelProvenanceMigration", () => {
  it("persists and broadcasts one server-authoritative warning state", () => {
    const migration = createModelProvenanceMigration(
      resolveUnknownModelProvenanceAuthority("gpt-5.6-terra"),
      "legacy_relaunch",
      123,
    );
    const session = { state: { model: "", modelProvenanceMigration: undefined } };
    const persistSessionById = vi.fn();
    const broadcastToSession = vi.fn();

    deliverModelProvenanceMigration("legacy", migration, {
      getOrCreateSession: vi.fn(() => session),
      persistSessionById,
      broadcastToSession,
    });

    expect(session.state).toEqual({ model: "gpt-5.6-terra", modelProvenanceMigration: migration });
    expect(persistSessionById).toHaveBeenCalledOnce();
    expect(broadcastToSession).toHaveBeenCalledWith("legacy", {
      type: "session_update",
      session: { model: "gpt-5.6-terra", modelProvenanceMigration: migration },
    });
  });
});
