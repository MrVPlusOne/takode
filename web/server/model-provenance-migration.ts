import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, type CanonicalJson, type ModelProvenanceMigration } from "./model-identity-contract.js";

const EVENT_ID_PREFIX = "model-provenance-migration:";
const LEGACY_EVENT_ID_PREFIX = `${EVENT_ID_PREFIX}legacy:`;

function legacyIdentityProjection(migration: ModelProvenanceMigration): CanonicalJson {
  return {
    code: migration.code,
    source: migration.source,
    selectedModel: migration.selectedModel,
    authority: {
      model: migration.authority.model,
      source: migration.authority.source,
      policyVersion: migration.authority.policyVersion,
      overrideTrace: migration.authority.overrideTrace.map((entry) => ({
        model: entry.model,
        source: entry.source,
        precedence: entry.precedence,
        status: entry.status,
      })),
    },
    migratedAt: migration.migratedAt,
    warning: migration.warning,
  };
}

export function createModelProvenanceMigrationEventId(): string {
  return `${EVENT_ID_PREFIX}${randomUUID()}`;
}

/** Backfill pre-event-ID records deterministically so inherited legacy copies stay one family. */
export function normalizeModelProvenanceMigration(migration: ModelProvenanceMigration): ModelProvenanceMigration {
  const eventId = (migration as Partial<ModelProvenanceMigration>).eventId;
  if (typeof eventId === "string" && eventId.trim()) return migration;
  const digest = createHash("sha256")
    .update(canonicalJson(legacyIdentityProjection(migration)), "utf8")
    .digest("hex");
  return { ...migration, eventId: `${LEGACY_EVENT_ID_PREFIX}${digest}` };
}

export function projectModelProvenanceMigrationAcknowledgement(
  migration: ModelProvenanceMigration,
  acknowledgedAt: number | undefined,
): ModelProvenanceMigration {
  const normalized = normalizeModelProvenanceMigration(migration);
  if (typeof acknowledgedAt !== "number" || !Number.isFinite(acknowledgedAt) || acknowledgedAt < 0) {
    return normalized;
  }
  if (normalized.acknowledgedAt === acknowledgedAt) return normalized;
  return { ...normalized, acknowledgedAt };
}
