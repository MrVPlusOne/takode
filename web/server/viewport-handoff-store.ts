import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MAX_VIEWPORT_HANDOFFS_PER_SESSION,
  VIEWPORT_HANDOFF_MAX_FUTURE_ACTIVITY_MS,
  VIEWPORT_HANDOFF_VERSION,
  createEmptyViewportHandoffSessionState,
  normalizeViewportHandoffActivityAt,
  normalizeViewportHandoffPosition,
  normalizeViewportHandoffRequiredId,
  normalizeViewportHandoffRevision,
  normalizeViewportHandoffSessionState,
  normalizeViewportHandoffThreadKey,
  type ViewportHandoffRecord,
  type ViewportHandoffSessionState,
  type ViewportHandoffWriteRequest,
  type ViewportHandoffWriteResponse,
} from "../shared/viewport-handoff.js";

const VIEWPORT_HANDOFF_CANDIDATE_SUFFIX = ".takode-candidate";
const MAX_RECENT_VIEWPORT_DEPARTURES = MAX_VIEWPORT_HANDOFFS_PER_SESSION * 4;

type AtomicWriter = (filePath: string, contents: string) => Promise<void>;

interface RecentViewportDeparture {
  sourceId: string;
  departureId: string;
  revision: number;
}

interface PersistedViewportHandoffSession extends ViewportHandoffSessionState {
  recentDepartures: RecentViewportDeparture[];
}

type LoadedViewportHandoffSession =
  | { status: "valid"; state: PersistedViewportHandoffSession }
  | { status: "invalid"; detail: string };

export class ViewportHandoffStoreError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_input" | "invalid_state" | "write_failed",
  ) {
    super(message);
    this.name = "ViewportHandoffStoreError";
  }
}

export async function replaceViewportHandoffFileAtomically(filePath: string, contents: string): Promise<void> {
  const directory = dirname(filePath);
  const candidatePath = `${filePath}${VIEWPORT_HANDOFF_CANDIDATE_SUFFIX}`;
  await mkdir(directory, { recursive: true });
  await removeFile(candidatePath);
  const candidate = await open(candidatePath, "wx", 0o600);
  try {
    await candidate.writeFile(contents, "utf8");
    await candidate.sync();
  } finally {
    await candidate.close();
  }
  await rename(candidatePath, filePath);
  await syncDirectoryBestEffort(directory);
}

export class ViewportHandoffStore {
  private readonly loaded = new Map<string, LoadedViewportHandoffSession>();
  private readonly operationChains = new Map<string, Promise<void>>();

  constructor(
    private readonly directory: string | null,
    private readonly writer: AtomicWriter = replaceViewportHandoffFileAtomically,
  ) {}

  /** Volatile fallback used only by broad route tests whose SessionStore doubles omit a directory. */
  static createVolatileForTest(): ViewportHandoffStore {
    return new ViewportHandoffStore(null);
  }

  readSession(sessionId: string): Promise<ViewportHandoffSessionState> {
    return this.runExclusive(sessionId, async () => cloneSessionState(await this.requireState(sessionId)));
  }

  readThread(
    sessionId: string,
    threadKey: string,
  ): Promise<{
    state: ViewportHandoffSessionState;
    record: ViewportHandoffRecord | null;
  }> {
    return this.runExclusive(sessionId, async () => {
      const normalizedThreadKey = normalizeViewportHandoffThreadKey(threadKey);
      if (!normalizedThreadKey) {
        throw new ViewportHandoffStoreError("Invalid viewport handoff thread key", "invalid_input");
      }
      const state = await this.requireState(sessionId);
      return {
        state: cloneSessionState(state),
        record: cloneRecord(state.handoffs[normalizedThreadKey] ?? null),
      };
    });
  }

  publish(
    sessionId: string,
    input: ViewportHandoffWriteRequest,
    now = Date.now(),
  ): Promise<ViewportHandoffWriteResponse> {
    return this.runExclusive(sessionId, async () => {
      const state = await this.requireState(sessionId);
      const serverNow = normalizeServerNow(now, state.updatedAt);
      if (serverNow === null) {
        throw new ViewportHandoffStoreError("Invalid viewport handoff server time", "invalid_input");
      }
      const normalizedInput = normalizeWriteRequest(input, serverNow);
      if (!normalizedInput) {
        throw new ViewportHandoffStoreError("Invalid viewport handoff write", "invalid_input");
      }
      const duplicate = state.recentDepartures.some(
        (departure) =>
          departure.sourceId === normalizedInput.sourceId && departure.departureId === normalizedInput.departureId,
      );
      if (duplicate) {
        return writeResponse("duplicate", state, normalizedInput.threadKey, serverNow);
      }

      const current = state.handoffs[normalizedInput.threadKey] ?? null;
      const currentRevision = current?.revision ?? null;
      const positionBaseMatches = currentRevision === normalizedInput.baseRevision;
      const positionHasNewerActivity =
        normalizedInput.lastDeliberateActivityAt !== null &&
        (current === null || normalizedInput.lastDeliberateActivityAt > current.activityAt);
      const shouldAdvancePosition = positionBaseMatches || positionHasNewerActivity;

      const selectionBaseMatches = normalizedInput.baseSelectedThreadRevision === state.selectedThreadRevision;
      const selectionHasNewerActivity =
        normalizedInput.lastSelectionActivityAt !== null &&
        normalizedInput.lastSelectionActivityAt > state.selectedThreadActivityAt;
      const shouldAdvanceSelection = selectionBaseMatches || selectionHasNewerActivity;

      if (!shouldAdvancePosition && !shouldAdvanceSelection) {
        return writeResponse("stale", state, normalizedInput.threadKey, serverNow);
      }
      if (state.revision >= Number.MAX_SAFE_INTEGER) {
        throw new ViewportHandoffStoreError("Viewport handoff revision is exhausted", "invalid_state");
      }

      const revision = state.revision + 1;
      const updatedAt = Math.max(serverNow, state.updatedAt + 1);
      const nextRecord: ViewportHandoffRecord | null = shouldAdvancePosition
        ? {
            version: VIEWPORT_HANDOFF_VERSION,
            threadKey: normalizedInput.threadKey,
            revision,
            sourceId: normalizedInput.sourceId,
            departureId: normalizedInput.departureId,
            activityAt: advanceAcceptedActivityAt(
              current?.activityAt ?? null,
              normalizedInput.lastDeliberateActivityAt,
            ),
            updatedAt,
            position: normalizedInput.position,
          }
        : current;
      const nextHandoffs = nextRecord
        ? limitHandoffs({
            ...state.handoffs,
            [normalizedInput.threadKey]: nextRecord,
          })
        : state.handoffs;
      const nextState: PersistedViewportHandoffSession = {
        version: VIEWPORT_HANDOFF_VERSION,
        sessionId,
        revision,
        updatedAt,
        selectedThreadKey: shouldAdvanceSelection ? normalizedInput.selectedThreadKey : state.selectedThreadKey,
        selectedThreadRevision: shouldAdvanceSelection ? revision : state.selectedThreadRevision,
        selectedThreadActivityAt: shouldAdvanceSelection
          ? advanceAcceptedActivityAt(
              state.selectedThreadRevision > 0 ? state.selectedThreadActivityAt : null,
              normalizedInput.lastSelectionActivityAt,
            )
          : state.selectedThreadActivityAt,
        selectedThreadUpdatedAt: shouldAdvanceSelection ? updatedAt : state.selectedThreadUpdatedAt,
        handoffs: nextHandoffs,
        recentDepartures: [
          ...state.recentDepartures,
          {
            sourceId: normalizedInput.sourceId,
            departureId: normalizedInput.departureId,
            revision,
          },
        ].slice(-MAX_RECENT_VIEWPORT_DEPARTURES),
      };

      try {
        if (this.directory) {
          await this.writer(this.filePath(sessionId), `${JSON.stringify(nextState, null, 2)}\n`);
        }
      } catch (error) {
        throw new ViewportHandoffStoreError(
          `Failed to persist viewport handoff: ${error instanceof Error ? error.message : String(error)}`,
          "write_failed",
        );
      }
      this.loaded.set(sessionId, { status: "valid", state: nextState });
      return writeResponse("accepted", nextState, normalizedInput.threadKey, updatedAt);
    });
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.runExclusive(sessionId, async () => {
      if (this.directory) {
        await Promise.all([
          removeFile(this.filePath(sessionId)),
          removeFile(`${this.filePath(sessionId)}${VIEWPORT_HANDOFF_CANDIDATE_SUFFIX}`),
        ]);
      }
      this.loaded.delete(sessionId);
    });
  }

  async flushForTest(): Promise<void> {
    await Promise.allSettled([...this.operationChains.values()]);
  }

  filePathForTest(sessionId: string): string {
    return this.filePath(sessionId);
  }

  private async requireState(sessionId: string): Promise<PersistedViewportHandoffSession> {
    const normalizedSessionId = normalizeViewportHandoffRequiredId(sessionId);
    if (!normalizedSessionId || normalizedSessionId !== sessionId) {
      throw new ViewportHandoffStoreError("Invalid viewport handoff session ID", "invalid_input");
    }
    const cached = this.loaded.get(sessionId);
    if (cached?.status === "valid") return cached.state;
    if (cached?.status === "invalid") {
      throw new ViewportHandoffStoreError(cached.detail, "invalid_state");
    }

    if (!this.directory) {
      const state = persistedEmptyState(sessionId);
      this.loaded.set(sessionId, { status: "valid", state });
      return state;
    }

    let raw: string;
    try {
      raw = await readFile(this.filePath(sessionId), "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        const state = persistedEmptyState(sessionId);
        this.loaded.set(sessionId, { status: "valid", state });
        return state;
      }
      const detail = `Failed to read viewport handoff state: ${error instanceof Error ? error.message : String(error)}`;
      this.loaded.set(sessionId, { status: "invalid", detail });
      throw new ViewportHandoffStoreError(detail, "invalid_state");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.rememberInvalid(sessionId, "Viewport handoff state is corrupt JSON");
    }
    const state = normalizePersistedState(parsed, sessionId);
    if (!state) return this.rememberInvalid(sessionId, "Viewport handoff state has an unsupported or invalid schema");
    this.loaded.set(sessionId, { status: "valid", state });
    await removeFile(`${this.filePath(sessionId)}${VIEWPORT_HANDOFF_CANDIDATE_SUFFIX}`).catch(() => {});
    return state;
  }

  private rememberInvalid(sessionId: string, detail: string): never {
    this.loaded.set(sessionId, { status: "invalid", detail });
    throw new ViewportHandoffStoreError(detail, "invalid_state");
  }

  private filePath(sessionId: string): string {
    if (!this.directory) throw new Error("Volatile viewport handoff stores do not have a file path");
    const key = createHash("sha256").update(sessionId).digest("hex");
    return join(this.directory, `${key}.json`);
  }

  private runExclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.operationChains.get(sessionId) ?? Promise.resolve();
    const result = prior.catch(() => {}).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.operationChains.set(sessionId, tail);
    void tail.finally(() => {
      if (this.operationChains.get(sessionId) === tail) this.operationChains.delete(sessionId);
    });
    return result;
  }
}

function advanceAcceptedActivityAt(currentActivityAt: number | null, reportedActivityAt: number | null): number {
  // Zero is neutral: an idle write must not inherit server commit time and outrank real client activity.
  return Math.max(currentActivityAt ?? 0, reportedActivityAt ?? 0);
}

function normalizeWriteRequest(
  input: ViewportHandoffWriteRequest,
  serverNow: number,
): ViewportHandoffWriteRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as unknown as Record<string, unknown>;
  const baseRevision = raw.baseRevision === null ? null : normalizeViewportHandoffRevision(raw.baseRevision);
  const baseSelectedThreadRevision = normalizeViewportHandoffRevision(raw.baseSelectedThreadRevision);
  const lastDeliberateActivityAt = normalizeViewportHandoffActivityAt(raw.lastDeliberateActivityAt);
  const lastSelectionActivityAt = normalizeViewportHandoffActivityAt(raw.lastSelectionActivityAt);
  const sourceId = normalizeViewportHandoffRequiredId(raw.sourceId);
  const departureId = normalizeViewportHandoffRequiredId(raw.departureId);
  const threadKey = normalizeViewportHandoffThreadKey(raw.threadKey);
  const selectedThreadKey = normalizeViewportHandoffThreadKey(raw.selectedThreadKey);
  const position = normalizeViewportHandoffPosition(raw.position);
  if (
    (raw.baseRevision !== null && baseRevision === null) ||
    baseSelectedThreadRevision === null ||
    (raw.lastDeliberateActivityAt !== null && lastDeliberateActivityAt === null) ||
    (raw.lastSelectionActivityAt !== null && lastSelectionActivityAt === null) ||
    (lastDeliberateActivityAt !== null &&
      lastDeliberateActivityAt > serverNow + VIEWPORT_HANDOFF_MAX_FUTURE_ACTIVITY_MS) ||
    (lastSelectionActivityAt !== null &&
      lastSelectionActivityAt > serverNow + VIEWPORT_HANDOFF_MAX_FUTURE_ACTIVITY_MS) ||
    !sourceId ||
    !departureId ||
    !threadKey ||
    !selectedThreadKey ||
    !position
  ) {
    return null;
  }
  return {
    baseRevision,
    baseSelectedThreadRevision,
    lastDeliberateActivityAt,
    lastSelectionActivityAt,
    sourceId,
    departureId,
    threadKey,
    selectedThreadKey,
    position,
  };
}

function normalizePersistedState(input: unknown, expectedSessionId: string): PersistedViewportHandoffSession | null {
  const state = normalizeViewportHandoffSessionState(input, expectedSessionId);
  if (!state || state.revision > Number.MAX_SAFE_INTEGER) return null;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.recentDepartures) || raw.recentDepartures.length > MAX_RECENT_VIEWPORT_DEPARTURES) return null;
  const seen = new Set<string>();
  const recentDepartures: RecentViewportDeparture[] = [];
  for (const entry of raw.recentDepartures) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const sourceId = normalizeViewportHandoffRequiredId(record.sourceId);
    const departureId = normalizeViewportHandoffRequiredId(record.departureId);
    const revision = normalizeViewportHandoffRevision(record.revision);
    if (!sourceId || !departureId || revision === null || revision < 1 || revision > state.revision) return null;
    const key = departureKey(sourceId, departureId);
    if (seen.has(key)) return null;
    seen.add(key);
    recentDepartures.push({ sourceId, departureId, revision });
  }
  return { ...state, recentDepartures };
}

function persistedEmptyState(sessionId: string): PersistedViewportHandoffSession {
  return {
    ...createEmptyViewportHandoffSessionState(sessionId),
    recentDepartures: [],
  };
}

function limitHandoffs(handoffs: Record<string, ViewportHandoffRecord>): Record<string, ViewportHandoffRecord> {
  return Object.fromEntries(
    Object.entries(handoffs)
      .sort((left, right) => right[1].revision - left[1].revision || left[0].localeCompare(right[0]))
      .slice(0, MAX_VIEWPORT_HANDOFFS_PER_SESSION),
  );
}

function writeResponse(
  status: ViewportHandoffWriteResponse["status"],
  state: PersistedViewportHandoffSession,
  threadKey: string,
  serverNow: number,
): ViewportHandoffWriteResponse {
  return {
    status,
    state: cloneSessionState(state),
    record: cloneRecord(state.handoffs[threadKey] ?? null),
    serverNow,
  };
}

function cloneSessionState(state: ViewportHandoffSessionState): ViewportHandoffSessionState {
  return {
    version: state.version,
    sessionId: state.sessionId,
    revision: state.revision,
    updatedAt: state.updatedAt,
    selectedThreadKey: state.selectedThreadKey,
    selectedThreadRevision: state.selectedThreadRevision,
    selectedThreadActivityAt: state.selectedThreadActivityAt,
    selectedThreadUpdatedAt: state.selectedThreadUpdatedAt,
    handoffs: Object.fromEntries(Object.entries(state.handoffs).map(([key, record]) => [key, cloneRecord(record)!])),
  };
}

function cloneRecord(record: ViewportHandoffRecord | null): ViewportHandoffRecord | null {
  return record ? { ...record, position: { ...record.position } } : null;
}

function normalizeServerNow(now: number, lastUpdatedAt: number): number | null {
  if (!Number.isFinite(now) || now < 0) return null;
  return Math.max(Math.floor(now), lastUpdatedAt);
}

function departureKey(sourceId: string, departureId: string): string {
  return `${sourceId}\u0000${departureId}`;
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !["EINVAL", "ENOTSUP", "EISDIR", "EBADF"].includes(code)) {
      console.warn(`[viewport-handoff] Directory fsync failed for ${directory}:`, error);
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}
