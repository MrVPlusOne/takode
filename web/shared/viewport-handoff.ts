export const VIEWPORT_HANDOFF_VERSION = 1 as const;
export const MAX_VIEWPORT_HANDOFFS_PER_SESSION = 32;
export const MAX_VIEWPORT_HANDOFF_ID_LENGTH = 512;
export const VIEWPORT_HANDOFF_MAX_FUTURE_ACTIVITY_MS = 30_000;

export interface ViewportHandoffPosition {
  scrollTop: number;
  scrollHeight: number;
  isAtBottom: boolean;
  anchorMessageId: string | null;
  anchorTurnId: string | null;
  anchorOffsetTop?: number;
  lastSeenContentBottom?: number | null;
}

export interface ViewportHandoffRecord {
  version: typeof VIEWPORT_HANDOFF_VERSION;
  threadKey: string;
  revision: number;
  sourceId: string;
  departureId: string;
  /** Client-calibrated meaningful activity ordering for this thread position. */
  activityAt: number;
  /** Monotonic server commit time for this thread position. */
  updatedAt: number;
  position: ViewportHandoffPosition;
}

export interface ViewportHandoffSessionState {
  version: typeof VIEWPORT_HANDOFF_VERSION;
  sessionId: string;
  /** Latest accepted mutation across every thread or selected-thread handoff in this session. */
  revision: number;
  /** Monotonic logical server time for the latest accepted mutation. */
  updatedAt: number;
  selectedThreadKey: string;
  selectedThreadRevision: number;
  /** Client-calibrated meaningful activity ordering for the selected-thread handoff. */
  selectedThreadActivityAt: number;
  /** Monotonic server commit time for the selected-thread handoff. */
  selectedThreadUpdatedAt: number;
  handoffs: Record<string, ViewportHandoffRecord>;
}

export interface ViewportHandoffReadResponse {
  state: ViewportHandoffSessionState;
  serverNow: number;
  /** Present for a thread-scoped read. */
  threadKey?: string;
  /** Present for a thread-scoped read; null means no handoff exists yet. */
  record?: ViewportHandoffRecord | null;
}

export interface ViewportHandoffWriteRequest {
  /** Revision of this thread's record at the caller's last successful read. */
  baseRevision: number | null;
  /** Revision of the selected-thread handoff at the caller's last successful read. */
  baseSelectedThreadRevision: number;
  lastDeliberateActivityAt: number | null;
  lastSelectionActivityAt: number | null;
  sourceId: string;
  departureId: string;
  threadKey: string;
  selectedThreadKey: string;
  position: ViewportHandoffPosition;
}

export type ViewportHandoffWriteStatus = "accepted" | "stale" | "duplicate";

export interface ViewportHandoffWriteResponse {
  status: ViewportHandoffWriteStatus;
  state: ViewportHandoffSessionState;
  record: ViewportHandoffRecord | null;
  serverNow: number;
}

export function createEmptyViewportHandoffSessionState(sessionId: string): ViewportHandoffSessionState {
  return {
    version: VIEWPORT_HANDOFF_VERSION,
    sessionId,
    revision: 0,
    updatedAt: 0,
    selectedThreadKey: "main",
    selectedThreadRevision: 0,
    selectedThreadActivityAt: 0,
    selectedThreadUpdatedAt: 0,
    handoffs: {},
  };
}

export function normalizeViewportHandoffThreadKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "main" || normalized === "all" || /^q-\d+$/.test(normalized)) return normalized;
  return null;
}

export function normalizeViewportHandoffPosition(value: unknown): ViewportHandoffPosition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const scrollTop = finiteNonNegativeNumber(record.scrollTop);
  const scrollHeight = finiteNonNegativeNumber(record.scrollHeight);
  if (scrollTop === null || scrollHeight === null || typeof record.isAtBottom !== "boolean") return null;
  const anchorMessageId = normalizeOptionalId(record.anchorMessageId);
  const anchorTurnId = normalizeOptionalId(record.anchorTurnId);
  const anchorOffsetTop = normalizeOptionalFiniteNumber(record, "anchorOffsetTop", false);
  const lastSeenContentBottom = normalizeOptionalFiniteNumber(record, "lastSeenContentBottom", true);
  if (
    anchorMessageId === undefined ||
    anchorTurnId === undefined ||
    !anchorOffsetTop.valid ||
    !lastSeenContentBottom.valid
  ) {
    return null;
  }
  return {
    scrollTop,
    scrollHeight,
    isAtBottom: record.isAtBottom,
    anchorMessageId,
    anchorTurnId,
    ...(anchorOffsetTop.present ? { anchorOffsetTop: anchorOffsetTop.value as number } : {}),
    ...(lastSeenContentBottom.present ? { lastSeenContentBottom: lastSeenContentBottom.value as number | null } : {}),
  };
}

export function normalizeViewportHandoffRecord(value: unknown): ViewportHandoffRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== VIEWPORT_HANDOFF_VERSION) return null;
  const threadKey = normalizeViewportHandoffThreadKey(raw.threadKey);
  const revision = nonNegativeSafeInteger(raw.revision);
  const sourceId = normalizeRequiredId(raw.sourceId);
  const departureId = normalizeRequiredId(raw.departureId);
  const activityAt = finiteNonNegativeNumber(raw.activityAt);
  const updatedAt = finiteNonNegativeNumber(raw.updatedAt);
  const position = normalizeViewportHandoffPosition(raw.position);
  if (
    !threadKey ||
    raw.threadKey !== threadKey ||
    revision === null ||
    revision < 1 ||
    !sourceId ||
    raw.sourceId !== sourceId ||
    !departureId ||
    raw.departureId !== departureId ||
    activityAt === null ||
    updatedAt === null ||
    !position
  ) {
    return null;
  }
  return {
    version: VIEWPORT_HANDOFF_VERSION,
    threadKey,
    revision,
    sourceId,
    departureId,
    activityAt,
    updatedAt,
    position,
  };
}

export function normalizeViewportHandoffSessionState(
  value: unknown,
  expectedSessionId?: string,
): ViewportHandoffSessionState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== VIEWPORT_HANDOFF_VERSION) return null;
  const sessionId = normalizeRequiredId(raw.sessionId);
  const revision = nonNegativeSafeInteger(raw.revision);
  const updatedAt = finiteNonNegativeNumber(raw.updatedAt);
  const selectedThreadKey = normalizeViewportHandoffThreadKey(raw.selectedThreadKey);
  const selectedThreadRevision = nonNegativeSafeInteger(raw.selectedThreadRevision);
  const selectedThreadActivityAt = finiteNonNegativeNumber(raw.selectedThreadActivityAt);
  const selectedThreadUpdatedAt = finiteNonNegativeNumber(raw.selectedThreadUpdatedAt);
  if (
    !sessionId ||
    raw.sessionId !== sessionId ||
    (expectedSessionId !== undefined && sessionId !== expectedSessionId) ||
    revision === null ||
    updatedAt === null ||
    selectedThreadRevision === null ||
    selectedThreadRevision > revision ||
    selectedThreadActivityAt === null ||
    selectedThreadUpdatedAt === null ||
    selectedThreadUpdatedAt > updatedAt ||
    (revision === 0 && updatedAt !== 0) ||
    (selectedThreadRevision === 0 && (selectedThreadKey !== "main" || selectedThreadUpdatedAt !== 0)) ||
    (selectedThreadRevision > 0 && selectedThreadUpdatedAt === 0)
  ) {
    return null;
  }
  if (
    !selectedThreadKey ||
    raw.selectedThreadKey !== selectedThreadKey ||
    !raw.handoffs ||
    typeof raw.handoffs !== "object" ||
    Array.isArray(raw.handoffs)
  ) {
    return null;
  }

  const handoffs: Record<string, ViewportHandoffRecord> = {};
  for (const [rawThreadKey, rawRecord] of Object.entries(raw.handoffs as Record<string, unknown>)) {
    const threadKey = normalizeViewportHandoffThreadKey(rawThreadKey);
    const record = normalizeViewportHandoffRecord(rawRecord);
    if (
      !threadKey ||
      rawThreadKey !== threadKey ||
      !record ||
      record.threadKey !== threadKey ||
      record.revision > revision ||
      record.updatedAt > updatedAt
    ) {
      return null;
    }
    handoffs[threadKey] = record;
  }
  if (Object.keys(handoffs).length > MAX_VIEWPORT_HANDOFFS_PER_SESSION) return null;

  return {
    version: VIEWPORT_HANDOFF_VERSION,
    sessionId,
    revision,
    updatedAt,
    selectedThreadKey,
    selectedThreadRevision,
    selectedThreadActivityAt,
    selectedThreadUpdatedAt,
    handoffs,
  };
}

export function normalizeViewportHandoffRequiredId(value: unknown): string | null {
  return normalizeRequiredId(value);
}

export function normalizeViewportHandoffRevision(value: unknown): number | null {
  return nonNegativeSafeInteger(value);
}

export function normalizeViewportHandoffActivityAt(value: unknown): number | null {
  return value === null ? null : finiteNonNegativeNumber(value);
}

function normalizeRequiredId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_VIEWPORT_HANDOFF_ID_LENGTH) return null;
  return normalized;
}

function normalizeOptionalId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_VIEWPORT_HANDOFF_ID_LENGTH) {
    return undefined;
  }
  return value;
}

function normalizeOptionalFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  allowNull: boolean,
): { valid: boolean; present: boolean; value?: number | null } {
  if (!(key in record) || record[key] === undefined) return { valid: true, present: false };
  if (record[key] === null) {
    return allowNull ? { valid: true, present: true, value: null } : { valid: false, present: true };
  }
  const value = finiteNumber(record[key]);
  return value === null ? { valid: false, present: true } : { valid: true, present: true, value };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  const normalized = finiteNumber(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
