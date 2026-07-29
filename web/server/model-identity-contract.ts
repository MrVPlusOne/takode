import { createHash } from "node:crypto";

export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const MODEL_IDENTITY_SCHEMA_MAJOR = 1;
export const MODEL_AUTHORITY_POLICY_VERSION = "takode-codex-default-v1";

export type ModelAuthoritySource =
  | "explicit_request"
  | "session_default"
  | "inherited_session"
  | "managed_fallback"
  | "launch_option";

export interface ModelAuthorityCandidate {
  source: ModelAuthoritySource;
  model: string;
  precedence: number;
}

export interface ModelAuthorityTraceEntry extends ModelAuthorityCandidate {
  status: "selected" | "same_value" | "overridden";
}

export interface ModelAuthorityDecision {
  model: string;
  source: ModelAuthoritySource;
  policyVersion: string;
  overrideTrace: ModelAuthorityTraceEntry[];
}

export type ModelProvenanceMigrationSource = "external_resume" | "legacy_relaunch" | "legacy_parent";

export interface ModelProvenanceMigration {
  code: "model_provenance_unavailable";
  source: ModelProvenanceMigrationSource;
  selectedModel: string;
  authority: ModelAuthorityDecision;
  migratedAt: number;
  warning: string;
}

export class ModelDefaultConflictError extends Error {
  readonly code = "model_default_conflict";

  constructor(readonly candidates: ModelAuthorityCandidate[]) {
    super(
      `model_default_conflict: competing model authorities at precedence ${candidates[0]?.precedence ?? "unknown"}: ${candidates
        .map((candidate) => `${candidate.source}=${candidate.model}`)
        .join(", ")}`,
    );
    this.name = "ModelDefaultConflictError";
  }
}

export function normalizeCanonicalModelId(value: string): string {
  const normalized = value.trim();
  if (!MODEL_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid canonical model id: ${JSON.stringify(value)}`);
  }
  return normalized;
}

export function resolveModelAuthority(
  rawCandidates: ModelAuthorityCandidate[],
  policyVersion = MODEL_AUTHORITY_POLICY_VERSION,
): ModelAuthorityDecision {
  const candidates = rawCandidates
    .map((candidate) => ({ ...candidate, model: normalizeCanonicalModelId(candidate.model) }))
    .sort((a, b) => b.precedence - a.precedence);
  if (candidates.length === 0) throw new Error("At least one model authority candidate is required");

  const winningPrecedence = candidates[0].precedence;
  const winners = candidates.filter((candidate) => candidate.precedence === winningPrecedence);
  const winningModels = new Set(winners.map((candidate) => candidate.model));
  if (winningModels.size > 1) throw new ModelDefaultConflictError(winners);

  const selected = winners[0];
  return {
    model: selected.model,
    source: selected.source,
    policyVersion,
    overrideTrace: candidates.map((candidate, index) => ({
      ...candidate,
      status: index === 0 ? "selected" : candidate.model === selected.model ? "same_value" : "overridden",
    })),
  };
}

export type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

export function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Canonical model contracts only support safe integers");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export interface CanonicalModelRouteEntry {
  schemaMajor: number;
  requestedCanonical: string;
  matchKind: "exact" | "bounded_variant" | "declared_alias";
  variantPolicy: null | { kind: "dated_suffix"; pattern: "-YYYYMMDD" };
  targetCanonical: string;
  provider: string;
  deployment: string;
  wireMode: string | null;
  alias: null | {
    id: string;
    version: number;
    label: string;
    reason: string;
    disclosed: boolean;
    deprecation: string | null;
  };
}

export function fingerprintModelRouteEntry(entry: CanonicalModelRouteEntry): string {
  return createHash("sha256")
    .update(canonicalJson(entry as unknown as CanonicalJson), "utf8")
    .digest("hex");
}

export function buildTakodeCatalogRouteEntry(model: string): CanonicalModelRouteEntry {
  const canonical = normalizeCanonicalModelId(model);
  return {
    schemaMajor: MODEL_IDENTITY_SCHEMA_MAJOR,
    requestedCanonical: canonical,
    matchKind: "exact",
    variantPolicy: null,
    targetCanonical: canonical,
    provider: "codex-catalog",
    deployment: canonical,
    wireMode: null,
    alias: null,
  };
}
