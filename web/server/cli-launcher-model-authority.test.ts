import { describe, expect, it } from "vitest";
import {
  ensureModelAuthority,
  resolveLaunchModelSelection,
  resolveUnknownModelProvenanceAuthority,
  type MutableModelAuthorityState,
} from "./cli-launcher-model-authority.js";

describe("unknown model provenance migration", () => {
  it("migrates a legacy parent once and freezes that choice across later child defaults", () => {
    const parent: MutableModelAuthorityState = { model: "legacy-unknown" };

    const delegate = resolveLaunchModelSelection(
      "codex",
      { backendType: "codex", parentSessionId: "legacy-parent", hidden: true },
      { parent, configuredDefaultModel: "gpt-5.6-terra" },
    );
    expect(delegate).toMatchObject({
      model: "gpt-5.6-terra",
      migratedParent: true,
      modelAuthority: { source: "session_default" },
      modelProvenanceMigration: { source: "legacy_parent", selectedModel: "gpt-5.6-terra" },
    });
    const originalMigration = parent.modelProvenanceMigration;

    const sideChat = resolveLaunchModelSelection(
      "codex",
      { backendType: "codex", parentSessionId: "legacy-parent", hidden: true, sideChatId: "chat-1" },
      { parent, configuredDefaultModel: "gpt-5.6-luna" },
    );
    expect(sideChat).toMatchObject({ model: "gpt-5.6-terra", migratedParent: false });
    expect(sideChat.modelProvenanceMigration).toBe(originalMigration);
    expect(parent.model).toBe("gpt-5.6-terra");
  });

  it("preserves trustworthy persisted authority without a migration warning", () => {
    const authority = resolveUnknownModelProvenanceAuthority("gpt-5.6-sol");
    const state = { model: authority.model, modelAuthority: authority };

    expect(ensureModelAuthority(state, "gpt-5.6-luna", "legacy_relaunch")).toEqual({
      migrationCreated: false,
      stateChanged: false,
      migration: undefined,
    });
    expect(state.model).toBe("gpt-5.6-sol");
  });

  it("restores top-level authority from historical migration without emitting a new event", () => {
    const authority = resolveUnknownModelProvenanceAuthority("gpt-5.6-terra");
    const migrated = ensureModelAuthority({ model: "unknown" }, "gpt-5.6-terra", "legacy_relaunch", 123);
    const state = { modelProvenanceMigration: migrated.migration };

    const restored = ensureModelAuthority(state, "gpt-5.6-luna", "legacy_relaunch", 456);
    expect(restored).toMatchObject({ migrationCreated: false, stateChanged: true });
    expect(state).toMatchObject({ model: "gpt-5.6-terra", modelAuthority: authority });
    expect(state.modelProvenanceMigration?.migratedAt).toBe(123);
  });
});
