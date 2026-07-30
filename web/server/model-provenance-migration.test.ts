import { describe, expect, it } from "vitest";
import type { ModelProvenanceMigration } from "./model-identity-contract.js";
import {
  createModelProvenanceMigrationEventId,
  normalizeModelProvenanceMigration,
  projectModelProvenanceMigrationAcknowledgement,
} from "./model-provenance-migration.js";

function legacyMigration(migratedAt = 123): ModelProvenanceMigration {
  return {
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
    warning: "Original provenance was unavailable",
  } as ModelProvenanceMigration;
}

describe("model provenance migration identity", () => {
  it("creates distinct opaque identities for genuinely new events", () => {
    expect(createModelProvenanceMigrationEventId()).not.toBe(createModelProvenanceMigrationEventId());
  });

  it("backfills inherited legacy copies deterministically but distinguishes a later event", () => {
    const parent = normalizeModelProvenanceMigration(legacyMigration());
    const child = normalizeModelProvenanceMigration({ ...legacyMigration() });
    const later = normalizeModelProvenanceMigration(legacyMigration(456));

    expect(child.eventId).toBe(parent.eventId);
    expect(later.eventId).not.toBe(parent.eventId);
  });

  it("adds acknowledgement without rewriting provenance audit fields", () => {
    const original = normalizeModelProvenanceMigration(legacyMigration());
    const acknowledged = projectModelProvenanceMigrationAcknowledgement(original, 789);

    expect(acknowledged).toEqual({ ...original, acknowledgedAt: 789 });
    expect(acknowledged.warning).toBe(original.warning);
    expect(acknowledged.authority).toBe(original.authority);
  });
});
