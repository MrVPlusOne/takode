import {
  normalizeViewportHandoffPosition,
  normalizeViewportHandoffThreadKey,
  type ViewportHandoffPosition,
  type ViewportHandoffReadResponse,
  type ViewportHandoffRecord,
  type ViewportHandoffSessionState,
  type ViewportHandoffWriteResponse,
} from "../../shared/viewport-handoff.js";
import {
  fetchViewportHandoffSession,
  fetchViewportHandoffThread,
  putViewportHandoff,
} from "../api/viewport-handoff.js";
import { useStore } from "../store.js";
import {
  getFeedViewportKey,
  persistLeaderSelectedThreadKey,
  persistLeaderViewportPosition,
  readLeaderViewportPosition,
  registerViewportHandoffPublisher,
} from "./thread-viewport.js";

export type ViewportHandoffEntryStatus = "idle" | "loading" | "ready" | "failed";

type ReadEntry<T> = {
  status: ViewportHandoffEntryStatus;
  entryId: string | null;
  pendingEntryIds: Set<string>;
  settledEntryIds: Set<string>;
  response: ViewportHandoffReadResponse | null;
  value: T | null;
  error: string | null;
  promise: Promise<ViewportHandoffReadResponse | null> | null;
  queuedPromises: Map<string, Promise<ViewportHandoffReadResponse | null>>;
};

type ClockEstimate = {
  lowerBoundMs: number;
  upperBoundMs: number;
  samples: number;
};

type DeliberateActivity = {
  localAt: number;
  estimatedServerAt: number | null;
};

type RecentDeparture = {
  fingerprint: string;
  departureId: string;
  promise: Promise<ViewportHandoffWriteResponse | null>;
  settled: boolean;
};

type PendingDepartureReceipt = {
  version: 1;
  serverId: string | null;
  sessionId: string;
  threadKey: string;
  selectedThreadKey: string;
  sourceId: string;
  departureId: string;
  baseRevision: number | null;
  baseSelectedThreadRevision: number;
  lastDeliberateActivityAt: number | null;
  lastSelectionActivityAt: number | null;
  position: ViewportHandoffPosition;
  initiatedAtLocal: number;
  initiatedAtServerLower: number | null;
  initiatedAtServerUpper: number | null;
};

type SessionClientState = {
  sessionRead: ReadEntry<ViewportHandoffSessionState>;
  threadReads: Map<string, ReadEntry<ViewportHandoffRecord>>;
  baselineState: ViewportHandoffSessionState | null;
  successfulFullRead: boolean;
  successfulThreadReads: Set<string>;
  deliberateActivity: Map<string, DeliberateActivity>;
  selectionActivity: (DeliberateActivity & { threadKey: string }) | null;
  recentDepartures: Map<string, RecentDeparture>;
  lastPublishSkip: string | null;
};

export interface LoadViewportHandoffOptions {
  /** A stable identity for one entry/mount. Reusing it coalesces StrictMode and duplicate reads. */
  entryId?: string;
  force?: boolean;
  signal?: AbortSignal;
}

export interface PublishViewportHandoffInput {
  sessionId: string;
  threadKey: string;
  selectedThreadKey: string;
  position: ViewportHandoffPosition;
  departureId?: string;
  keepalive?: boolean;
  signal?: AbortSignal;
}

export type ViewportHandoffPositionInput = Omit<ViewportHandoffPosition, "anchorMessageId" | "anchorTurnId"> & {
  anchorMessageId?: string | null;
  anchorTurnId?: string | null;
};

export interface PublishViewportHandoffOptions {
  selectedThreadKey?: string;
  departureId?: string;
  keepalive?: boolean;
  signal?: AbortSignal;
  /** Diagnostic-only boundary classification; the server contract stays payload-minimal. */
  reason?: string;
}

const BROWSER_ID_KEY_PREFIX = "takode:viewport-handoff-browser";
const PENDING_DEPARTURE_KEY_PREFIX = "takode:viewport-handoff-pending";
const PENDING_DEPARTURE_MAX_AGE_MS = 5 * 60_000;
const ENTRY_PENDING_WRITE_WAIT_MS = 750;
const sessionStates = new Map<string, SessionClientState>();
const pageIds = new Map<string, string>();
const fallbackBrowserIds = new Map<string, string>();
const clockEstimates = new Map<string, ClockEstimate>();
const listeners = new Set<() => void>();
let clientVersion = 0;
let activeServerScope: string | null = null;

function emptyReadEntry<T>(): ReadEntry<T> {
  return {
    status: "idle",
    entryId: null,
    pendingEntryIds: new Set(),
    settledEntryIds: new Set(),
    response: null,
    value: null,
    error: null,
    promise: null,
    queuedPromises: new Map(),
  };
}

function sessionCacheKey(scope: string, sessionId: string): string {
  return `${scope}\u0000${sessionId}`;
}

function getSessionClientState(sessionId: string, scope = currentServerScope()): SessionClientState {
  const key = sessionCacheKey(scope, sessionId);
  let state = sessionStates.get(key);
  if (!state) {
    state = {
      sessionRead: emptyReadEntry(),
      threadReads: new Map(),
      baselineState: null,
      successfulFullRead: false,
      successfulThreadReads: new Set(),
      deliberateActivity: new Map(),
      selectionActivity: null,
      recentDepartures: new Map(),
      lastPublishSkip: null,
    };
    sessionStates.set(key, state);
  }
  return state;
}

function getThreadReadEntry(state: SessionClientState, threadKey: string): ReadEntry<ViewportHandoffRecord> {
  let entry = state.threadReads.get(threadKey);
  if (!entry) {
    entry = emptyReadEntry();
    state.threadReads.set(threadKey, entry);
  }
  return entry;
}

function emitChange(): void {
  clientVersion++;
  for (const listener of [...listeners]) listener();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}:${suffix}`;
}

function currentServerScope(): string {
  if (typeof window === "undefined") return "server:ssr";
  if (activeServerScope) return activeServerScope;
  let serverId: string | null = null;
  try {
    serverId = window.localStorage.getItem("cc-server-id")?.trim() || null;
  } catch {
    // The origin remains a stable page-lifetime scope when storage is unavailable.
  }
  activeServerScope = serverId ? `server:${serverId}` : `origin:${window.location.origin}`;
  return activeServerScope;
}

function browserStorageKey(scope: string): string {
  return `${BROWSER_ID_KEY_PREFIX}:${scope}`;
}

function getBrowserId(scope = currentServerScope()): string {
  if (typeof window !== "undefined") {
    try {
      const key = browserStorageKey(scope);
      const existing = window.sessionStorage.getItem(key)?.trim();
      if (existing) return existing;
      const created = makeId("browser");
      window.sessionStorage.setItem(key, created);
      return created;
    } catch {
      // Sandboxed/private contexts can reject sessionStorage. Keep one page-local fallback.
    }
  }
  let fallback = fallbackBrowserIds.get(scope);
  if (!fallback) {
    fallback = makeId("browser");
    fallbackBrowserIds.set(scope, fallback);
  }
  return fallback;
}

function getPageId(scope = currentServerScope()): string {
  let pageId = pageIds.get(scope);
  if (!pageId) {
    pageId = makeId("page");
    pageIds.set(scope, pageId);
  }
  return pageId;
}

function getSourceId(scope = currentServerScope()): string {
  return `${getBrowserId(scope)}/${getPageId(scope)}`;
}

function currentServerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cc-server-id")?.trim() || null;
  } catch {
    return null;
  }
}

function pendingDepartureStorageKey(sessionId: string, threadKey: string): string {
  return `${PENDING_DEPARTURE_KEY_PREFIX}:${sessionId}:${threadKey}`;
}

function removePendingDepartureStorageKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Best effort only.
  }
}

function readPendingDepartureReceipt(sessionId: string, threadKey: string): PendingDepartureReceipt | null {
  if (typeof window === "undefined") return null;
  const key = pendingDepartureStorageKey(sessionId, threadKey);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    const normalizedThreadKey = normalizeViewportHandoffThreadKey(value.threadKey);
    const normalizedSelectedThreadKey = normalizeViewportHandoffThreadKey(value.selectedThreadKey);
    const position = normalizeViewportHandoffPosition(value.position);
    const serverId = typeof value.serverId === "string" && value.serverId.trim() ? value.serverId.trim() : null;
    const currentId = currentServerId();
    const valid =
      value.version === 1 &&
      value.sessionId === sessionId &&
      normalizedThreadKey === threadKey &&
      normalizedSelectedThreadKey !== null &&
      typeof value.sourceId === "string" &&
      value.sourceId.length > 0 &&
      typeof value.departureId === "string" &&
      value.departureId.length > 0 &&
      typeof value.initiatedAtLocal === "number" &&
      Number.isFinite(value.initiatedAtLocal) &&
      value.initiatedAtLocal >= 0 &&
      (value.initiatedAtServerLower === null ||
        (typeof value.initiatedAtServerLower === "number" &&
          Number.isFinite(value.initiatedAtServerLower) &&
          value.initiatedAtServerLower >= 0)) &&
      (value.initiatedAtServerUpper === null ||
        (typeof value.initiatedAtServerUpper === "number" &&
          Number.isFinite(value.initiatedAtServerUpper) &&
          value.initiatedAtServerUpper >= 0)) &&
      (value.initiatedAtServerLower === null ||
        value.initiatedAtServerUpper === null ||
        value.initiatedAtServerLower <= value.initiatedAtServerUpper) &&
      (value.baseRevision === null ||
        (typeof value.baseRevision === "number" &&
          Number.isSafeInteger(value.baseRevision) &&
          value.baseRevision >= 1)) &&
      typeof value.baseSelectedThreadRevision === "number" &&
      Number.isSafeInteger(value.baseSelectedThreadRevision) &&
      value.baseSelectedThreadRevision >= 0 &&
      (value.lastDeliberateActivityAt === null ||
        (typeof value.lastDeliberateActivityAt === "number" &&
          Number.isFinite(value.lastDeliberateActivityAt) &&
          value.lastDeliberateActivityAt >= 0)) &&
      (value.lastSelectionActivityAt === null ||
        (typeof value.lastSelectionActivityAt === "number" &&
          Number.isFinite(value.lastSelectionActivityAt) &&
          value.lastSelectionActivityAt >= 0)) &&
      position !== null &&
      (!serverId || !currentId || serverId === currentId);
    if (!valid || Date.now() - (value.initiatedAtLocal as number) > PENDING_DEPARTURE_MAX_AGE_MS) {
      removePendingDepartureStorageKey(key);
      return null;
    }
    return {
      version: 1,
      serverId,
      sessionId,
      threadKey,
      selectedThreadKey: normalizedSelectedThreadKey,
      sourceId: value.sourceId as string,
      departureId: value.departureId as string,
      baseRevision: value.baseRevision as number | null,
      baseSelectedThreadRevision: value.baseSelectedThreadRevision as number,
      lastDeliberateActivityAt: value.lastDeliberateActivityAt as number | null,
      lastSelectionActivityAt: value.lastSelectionActivityAt as number | null,
      position,
      initiatedAtLocal: value.initiatedAtLocal as number,
      initiatedAtServerLower: value.initiatedAtServerLower as number | null,
      initiatedAtServerUpper: value.initiatedAtServerUpper as number | null,
    };
  } catch {
    removePendingDepartureStorageKey(key);
    return null;
  }
}

function writePendingDepartureReceipt(receipt: PendingDepartureReceipt): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      pendingDepartureStorageKey(receipt.sessionId, receipt.threadKey),
      JSON.stringify(receipt),
    );
  } catch {
    // Reload ordering retains the normal local/browser fallback when storage is unavailable.
  }
}

function clearPendingDepartureReceipt(sessionId: string, threadKey: string, departureId?: string): void {
  if (typeof window === "undefined") return;
  const key = pendingDepartureStorageKey(sessionId, threadKey);
  try {
    if (departureId) {
      const current = readPendingDepartureReceipt(sessionId, threadKey);
      if (current && current.departureId !== departureId) return;
    }
    removePendingDepartureStorageKey(key);
  } catch {
    // Best effort only. Invalid receipts fail closed on their next read.
  }
}

function pendingDepartureReceiptsForSession(sessionId: string): PendingDepartureReceipt[] {
  if (typeof window === "undefined") return [];
  const prefix = `${PENDING_DEPARTURE_KEY_PREFIX}:${sessionId}:`;
  const receipts: PendingDepartureReceipt[] = [];
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index++) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      const threadKey = normalizeViewportHandoffThreadKey(key.slice(prefix.length));
      if (!threadKey) {
        removePendingDepartureStorageKey(key);
        continue;
      }
      const receipt = readPendingDepartureReceipt(sessionId, threadKey);
      if (receipt) receipts.push(receipt);
    }
  } catch {
    return [];
  }
  return receipts;
}

function pendingReceiptDecision(
  receipt: PendingDepartureReceipt,
  state: ViewportHandoffSessionState,
): { position: boolean; selection: boolean } {
  const record = state.handoffs[receipt.threadKey] ?? null;
  if (record?.departureId === receipt.departureId && record.sourceId === receipt.sourceId) {
    clearPendingDepartureReceipt(receipt.sessionId, receipt.threadKey, receipt.departureId);
    return { position: false, selection: false };
  }
  const position =
    (record?.revision ?? null) === receipt.baseRevision ||
    (receipt.lastDeliberateActivityAt !== null &&
      (record === null || receipt.lastDeliberateActivityAt > record.activityAt));
  const selection =
    state.selectedThreadRevision === receipt.baseSelectedThreadRevision ||
    (receipt.lastSelectionActivityAt !== null && receipt.lastSelectionActivityAt > state.selectedThreadActivityAt);
  if (!position && !selection) {
    clearPendingDepartureReceipt(receipt.sessionId, receipt.threadKey, receipt.departureId);
  }
  return { position, selection };
}

function recordClockSample(scope: string, startedAt: number, receivedAt: number, serverNow: number): void {
  if (!Number.isFinite(serverNow) || serverNow < 0) return;
  const sampleLower = serverNow - receivedAt;
  const sampleUpper = serverNow - startedAt;
  const current = clockEstimates.get(scope);
  if (!current) {
    clockEstimates.set(scope, { lowerBoundMs: sampleLower, upperBoundMs: sampleUpper, samples: 1 });
    return;
  }
  const lowerBoundMs = Math.max(current.lowerBoundMs, sampleLower);
  const upperBoundMs = Math.min(current.upperBoundMs, sampleUpper);
  clockEstimates.set(
    scope,
    lowerBoundMs <= upperBoundMs
      ? { lowerBoundMs, upperBoundMs, samples: current.samples + 1 }
      : { lowerBoundMs: sampleLower, upperBoundMs: sampleUpper, samples: current.samples + 1 },
  );
}

function estimateServerTime(scope: string, localAt: number): number | null {
  const clockEstimate = clockEstimates.get(scope);
  if (!clockEstimate || !Number.isFinite(localAt)) return null;
  // The lower bound assumes all round-trip delay happened after the server sample.
  // It deliberately underestimates recency rather than letting a stale client win.
  return Math.max(0, Math.floor(localAt + clockEstimate.lowerBoundMs));
}

function estimateServerTimeBounds(scope: string, localAt: number): { lower: number | null; upper: number | null } {
  const clockEstimate = clockEstimates.get(scope);
  if (!clockEstimate || !Number.isFinite(localAt)) return { lower: null, upper: null };
  return {
    lower: Math.max(0, Math.floor(localAt + clockEstimate.lowerBoundMs)),
    upper: Math.max(0, Math.ceil(localAt + clockEstimate.upperBoundMs)),
  };
}

function hydrateEntryState(
  scope: string,
  sessionId: string,
  response: ViewportHandoffReadResponse,
  threadKey?: string,
): void {
  const receipts = threadKey
    ? [readPendingDepartureReceipt(sessionId, threadKey)].filter(
        (receipt): receipt is PendingDepartureReceipt => receipt !== null,
      )
    : pendingDepartureReceiptsForSession(sessionId);
  const receiptDecisions = receipts.map((receipt) => ({
    receipt,
    decision: pendingReceiptDecision(receipt, response.state),
  }));
  const clientState = getSessionClientState(sessionId, scope);
  for (const { receipt, decision } of receiptDecisions) {
    if (!decision.position || receipt.lastDeliberateActivityAt === null) continue;
    const current = clientState.deliberateActivity.get(receipt.threadKey);
    clientState.deliberateActivity.set(receipt.threadKey, {
      localAt: Math.max(current?.localAt ?? 0, receipt.initiatedAtLocal),
      estimatedServerAt: Math.max(current?.estimatedServerAt ?? 0, receipt.lastDeliberateActivityAt),
    });
  }

  if (!threadKey) {
    const latestSelectionReceipt = receiptDecisions
      .filter(({ decision }) => decision.selection)
      .map(({ receipt }) => receipt)
      .sort(
        (left, right) =>
          (right.lastSelectionActivityAt ?? -1) - (left.lastSelectionActivityAt ?? -1) ||
          right.initiatedAtLocal - left.initiatedAtLocal,
      )[0];
    persistLeaderSelectedThreadKey(
      sessionId,
      latestSelectionReceipt?.selectedThreadKey ?? response.state.selectedThreadKey,
    );
    if (latestSelectionReceipt && latestSelectionReceipt.lastSelectionActivityAt !== null) {
      const current = clientState.selectionActivity;
      if (
        current?.estimatedServerAt == null ||
        current.estimatedServerAt <= latestSelectionReceipt.lastSelectionActivityAt
      ) {
        clientState.selectionActivity = {
          threadKey: latestSelectionReceipt.selectedThreadKey,
          localAt: Math.max(current?.localAt ?? 0, latestSelectionReceipt.initiatedAtLocal),
          estimatedServerAt: latestSelectionReceipt.lastSelectionActivityAt,
        };
      }
    }
  }

  const positions = new Map<string, ViewportHandoffPosition>();
  const records = threadKey ? (response.record ? [response.record] : []) : Object.values(response.state.handoffs);
  for (const record of records) positions.set(record.threadKey, record.position);
  for (const { receipt, decision } of receiptDecisions) {
    if (decision.position) positions.set(receipt.threadKey, receipt.position);
  }

  const store = useStore.getState();
  for (const [positionThreadKey, position] of positions) {
    const viewportKey = getFeedViewportKey(sessionId, positionThreadKey);
    store.setFeedScrollPosition(viewportKey, position);
    persistLeaderViewportPosition(sessionId, positionThreadKey, position);
  }
}

function newerBaselineState(
  current: ViewportHandoffSessionState | null,
  incoming: ViewportHandoffSessionState,
): ViewportHandoffSessionState {
  return current && current.revision > incoming.revision ? current : incoming;
}

function applyReadBaseline(
  scope: string,
  sessionId: string,
  response: ViewportHandoffReadResponse,
): { state: SessionClientState; response: ViewportHandoffReadResponse } {
  const state = getSessionClientState(sessionId, scope);
  const baselineState = newerBaselineState(state.baselineState, response.state);
  state.baselineState = baselineState;
  state.lastPublishSkip = null;
  for (const [threadKey, activity] of state.deliberateActivity) {
    const nextEstimate = estimateServerTime(scope, activity.localAt);
    state.deliberateActivity.set(threadKey, {
      ...activity,
      estimatedServerAt:
        activity.estimatedServerAt == null
          ? nextEstimate
          : nextEstimate == null
            ? activity.estimatedServerAt
            : Math.min(activity.estimatedServerAt, nextEstimate),
    });
  }
  if (state.selectionActivity) {
    const nextEstimate = estimateServerTime(scope, state.selectionActivity.localAt);
    state.selectionActivity = {
      ...state.selectionActivity,
      estimatedServerAt:
        state.selectionActivity.estimatedServerAt == null
          ? nextEstimate
          : nextEstimate == null
            ? state.selectionActivity.estimatedServerAt
            : Math.min(state.selectionActivity.estimatedServerAt, nextEstimate),
    };
  }
  if (baselineState === response.state) return { state, response };
  const threadKey = response.threadKey;
  return {
    state,
    response: {
      state: baselineState,
      serverNow: response.serverNow,
      ...(threadKey
        ? {
            threadKey,
            record: baselineState.handoffs[threadKey] ?? null,
          }
        : {}),
    },
  };
}

function updateBaselineFromWrite(scope: string, sessionId: string, response: ViewportHandoffWriteResponse): void {
  const state = getSessionClientState(sessionId, scope);
  // Do not update sessionRead.value or threadReads[*].value here. Those values are
  // frozen entry snapshots; an accepted/stale response is only the next-write baseline.
  state.baselineState = newerBaselineState(state.baselineState, response.state);
  state.lastPublishSkip = null;
}

function normalizeEntryId(entryId: string | undefined, prefix: string): string {
  return entryId?.trim() || makeId(prefix);
}

export function createViewportHandoffEntryId(): string {
  return makeId("entry");
}

export function createViewportHandoffDepartureId(scope = currentServerScope()): string {
  return `${getPageId(scope)}/${makeId("departure")}`;
}

function queueReadAfterCurrent(
  entry: ReadEntry<unknown>,
  entryId: string,
  load: () => Promise<ViewportHandoffReadResponse | null>,
): Promise<ViewportHandoffReadResponse | null> {
  const existing = entry.queuedPromises.get(entryId);
  if (existing) return existing;
  const current = entry.promise;
  if (!current) return load();
  const queued = current.then(load);
  entry.queuedPromises.set(entryId, queued);
  void queued.finally(() => {
    if (entry.queuedPromises.get(entryId) === queued) entry.queuedPromises.delete(entryId);
  });
  return queued;
}

function pendingDeparturePromises(state: SessionClientState, threadKey?: string): Promise<unknown>[] {
  const departures = threadKey ? [state.recentDepartures.get(threadKey)] : [...state.recentDepartures.values()];
  return departures
    .filter((departure): departure is RecentDeparture => Boolean(departure && !departure.settled))
    .map((d) => d.promise);
}

function waitForPendingDepartures(promises: Promise<unknown>[], signal?: AbortSignal): Promise<void> {
  if (promises.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, ENTRY_PENDING_WRITE_WAIT_MS);
    signal?.addEventListener("abort", finish, { once: true });
    void Promise.allSettled(promises).then(finish);
  });
}

export function loadViewportHandoffSession(
  sessionId: string,
  options: LoadViewportHandoffOptions = {},
): Promise<ViewportHandoffReadResponse | null> {
  const scope = currentServerScope();
  const state = getSessionClientState(sessionId, scope);
  const entry = state.sessionRead;
  const entryId = normalizeEntryId(options.entryId, "session-entry");
  if (entry.promise) {
    if (entry.pendingEntryIds.has(entryId)) return entry.promise;
    return queueReadAfterCurrent(entry, entryId, () =>
      loadViewportHandoffSession(sessionId, { ...options, entryId, force: true }),
    );
  }
  if (!options.force && entry.settledEntryIds.has(entryId)) return Promise.resolve(entry.response);

  entry.status = "loading";
  entry.entryId = entryId;
  entry.pendingEntryIds.add(entryId);
  entry.error = null;
  entry.response = null;
  entry.value = null;
  emitChange();

  let startedAt = 0;
  const promise = waitForPendingDepartures(pendingDeparturePromises(state), options.signal)
    .then(() => {
      startedAt = Date.now();
      return fetchViewportHandoffSession(sessionId, options.signal);
    })
    .then((response) => {
      recordClockSample(scope, startedAt, Date.now(), response.serverNow);
      const applied = applyReadBaseline(scope, sessionId, response);
      const effectiveResponse = applied.response;
      hydrateEntryState(scope, sessionId, effectiveResponse);
      const current = applied.state.sessionRead;
      current.status = "ready";
      current.settledEntryIds = new Set([...current.settledEntryIds, ...current.pendingEntryIds]);
      current.pendingEntryIds.clear();
      current.response = effectiveResponse;
      current.value = effectiveResponse.state;
      current.error = null;
      current.promise = null;
      applied.state.successfulFullRead = true;
      emitChange();
      return effectiveResponse;
    })
    .catch((error: unknown) => {
      const current = getSessionClientState(sessionId, scope).sessionRead;
      current.status = "failed";
      current.settledEntryIds = new Set([...current.settledEntryIds, ...current.pendingEntryIds]);
      current.pendingEntryIds.clear();
      current.response = null;
      current.value = null;
      current.error = errorMessage(error);
      current.promise = null;
      emitChange();
      return null;
    });
  entry.promise = promise;
  return promise;
}

export function loadViewportHandoffThread(
  sessionId: string,
  threadKey: string,
  options: LoadViewportHandoffOptions = {},
): Promise<ViewportHandoffReadResponse | null> {
  const normalizedThreadKey = normalizeViewportHandoffThreadKey(threadKey);
  if (!normalizedThreadKey) return Promise.resolve(null);
  const scope = currentServerScope();
  const state = getSessionClientState(sessionId, scope);
  const entry = getThreadReadEntry(state, normalizedThreadKey);
  const entryId = normalizeEntryId(options.entryId, "thread-entry");
  if (entry.promise) {
    if (entry.pendingEntryIds.has(entryId)) return entry.promise;
    return queueReadAfterCurrent(entry, entryId, () =>
      loadViewportHandoffThread(sessionId, normalizedThreadKey, { ...options, entryId, force: true }),
    );
  }
  if (!options.force && entry.settledEntryIds.has(entryId)) return Promise.resolve(entry.response);

  entry.status = "loading";
  entry.entryId = entryId;
  entry.pendingEntryIds.add(entryId);
  entry.error = null;
  entry.response = null;
  entry.value = null;
  emitChange();

  let startedAt = 0;
  const promise = waitForPendingDepartures(pendingDeparturePromises(state, normalizedThreadKey), options.signal)
    .then(() => {
      startedAt = Date.now();
      return fetchViewportHandoffThread(sessionId, normalizedThreadKey, options.signal);
    })
    .then((response) => {
      recordClockSample(scope, startedAt, Date.now(), response.serverNow);
      const applied = applyReadBaseline(scope, sessionId, response);
      const effectiveResponse = applied.response;
      hydrateEntryState(scope, sessionId, effectiveResponse, normalizedThreadKey);
      const current = getThreadReadEntry(applied.state, normalizedThreadKey);
      current.status = "ready";
      current.settledEntryIds = new Set([...current.settledEntryIds, ...current.pendingEntryIds]);
      current.pendingEntryIds.clear();
      current.response = effectiveResponse;
      current.value = effectiveResponse.record ?? null;
      current.error = null;
      current.promise = null;
      applied.state.successfulThreadReads.add(normalizedThreadKey);
      emitChange();
      return effectiveResponse;
    })
    .catch((error: unknown) => {
      const current = getThreadReadEntry(getSessionClientState(sessionId, scope), normalizedThreadKey);
      current.status = "failed";
      current.settledEntryIds = new Set([...current.settledEntryIds, ...current.pendingEntryIds]);
      current.pendingEntryIds.clear();
      current.response = null;
      current.value = null;
      current.error = errorMessage(error);
      current.promise = null;
      emitChange();
      return null;
    });
  entry.promise = promise;
  return promise;
}

export function noteViewportDeliberateActivity(
  sessionId: string,
  threadKey: string,
  localAt = Date.now(),
): number | null {
  const normalizedThreadKey = normalizeViewportHandoffThreadKey(threadKey);
  if (!normalizedThreadKey || !Number.isFinite(localAt) || localAt < 0) return null;
  const scope = currentServerScope();
  const state = getSessionClientState(sessionId, scope);
  const previous = state.deliberateActivity.get(normalizedThreadKey);
  const normalizedLocalAt = Math.max(previous?.localAt ?? 0, localAt);
  const estimatedServerAt =
    previous && normalizedLocalAt === previous.localAt
      ? previous.estimatedServerAt
      : estimateServerTime(scope, normalizedLocalAt);
  state.deliberateActivity.set(normalizedThreadKey, { localAt: normalizedLocalAt, estimatedServerAt });
  emitChange();
  return estimatedServerAt;
}

export function noteViewportSelectionActivity(
  sessionId: string,
  selectedThreadKey: string,
  localAt = Date.now(),
): number | null {
  const threadKey = normalizeViewportHandoffThreadKey(selectedThreadKey);
  if (!threadKey || !Number.isFinite(localAt) || localAt < 0) return null;
  const scope = currentServerScope();
  const state = getSessionClientState(sessionId, scope);
  const previous = state.selectionActivity;
  const normalizedLocalAt = previous ? Math.max(localAt, previous.localAt + 1) : localAt;
  const estimatedServerAt = estimateServerTime(scope, normalizedLocalAt);
  state.selectionActivity = { threadKey, localAt: normalizedLocalAt, estimatedServerAt };
  emitChange();
  return estimatedServerAt;
}

function publishFingerprint(
  input: Omit<PublishViewportHandoffInput, "position"> & { position: ViewportHandoffPosition },
  activityAt: number | null,
  selectionActivityAt: number | null,
  baselineState: ViewportHandoffSessionState,
): string {
  return JSON.stringify({
    threadKey: input.threadKey,
    selectedThreadKey: input.selectedThreadKey,
    position: input.position,
    activityAt,
    selectionActivityAt,
    baseRevision: baselineState.handoffs[input.threadKey]?.revision ?? null,
    baseSelectedThreadRevision: baselineState.selectedThreadRevision,
  });
}

export function publishViewportHandoff(
  input: PublishViewportHandoffInput,
): Promise<ViewportHandoffWriteResponse | null>;
export function publishViewportHandoff(
  sessionId: string,
  threadKey: string,
  position: ViewportHandoffPositionInput,
  options?: PublishViewportHandoffOptions,
): Promise<ViewportHandoffWriteResponse | null>;
export function publishViewportHandoff(
  inputOrSessionId: PublishViewportHandoffInput | string,
  positionalThreadKey?: string,
  positionalPosition?: ViewportHandoffPositionInput,
  positionalOptions: PublishViewportHandoffOptions = {},
): Promise<ViewportHandoffWriteResponse | null> {
  const input =
    typeof inputOrSessionId === "string"
      ? {
          sessionId: inputOrSessionId,
          threadKey: positionalThreadKey ?? "main",
          selectedThreadKey: positionalOptions.selectedThreadKey ?? positionalThreadKey ?? "main",
          position: positionalPosition,
          departureId: positionalOptions.departureId,
          keepalive: positionalOptions.keepalive,
          signal: positionalOptions.signal,
        }
      : inputOrSessionId;
  const threadKey = normalizeViewportHandoffThreadKey(input.threadKey);
  const selectedThreadKey = normalizeViewportHandoffThreadKey(input.selectedThreadKey);
  const position = normalizeViewportHandoffPosition(input.position);
  if (!threadKey || !selectedThreadKey || !position) return Promise.resolve(null);

  const scope = currentServerScope();
  const state = getSessionClientState(input.sessionId, scope);
  const hasSuccessfulRead = state.successfulFullRead || state.successfulThreadReads.has(threadKey);
  if (!hasSuccessfulRead || !state.baselineState) {
    state.lastPublishSkip = "backend-read-required";
    emitChange();
    return Promise.resolve(null);
  }

  const baselineState = state.baselineState;
  const activity = state.deliberateActivity.get(threadKey);
  const lastDeliberateActivityAt =
    activity?.estimatedServerAt ?? (activity ? estimateServerTime(scope, activity.localAt) : null);
  if (activity && activity.estimatedServerAt == null) {
    state.deliberateActivity.set(threadKey, { ...activity, estimatedServerAt: lastDeliberateActivityAt });
  }
  const selectionActivity = state.selectionActivity?.threadKey === selectedThreadKey ? state.selectionActivity : null;
  const estimatedSelectionActivity =
    selectionActivity?.estimatedServerAt ??
    (selectionActivity ? estimateServerTime(scope, selectionActivity.localAt) : null);
  if (selectionActivity && selectionActivity.estimatedServerAt == null) {
    state.selectionActivity = { ...selectionActivity, estimatedServerAt: estimatedSelectionActivity };
  }
  const lastSelectionActivityAt = Math.max(
    selectedThreadKey === threadKey ? (lastDeliberateActivityAt ?? -1) : -1,
    estimatedSelectionActivity ?? -1,
  );
  const normalizedLastSelectionActivityAt = lastSelectionActivityAt >= 0 ? lastSelectionActivityAt : null;
  const normalizedInput = { ...input, threadKey, selectedThreadKey, position };
  const fingerprint = publishFingerprint(
    normalizedInput,
    lastDeliberateActivityAt,
    normalizedLastSelectionActivityAt,
    baselineState,
  );
  const recent = state.recentDepartures.get(threadKey);
  if (
    recent &&
    (recent.fingerprint === fingerprint || (input.departureId && recent.departureId === input.departureId))
  ) {
    return recent.promise;
  }

  const departureId = input.departureId?.trim() || createViewportHandoffDepartureId(scope);
  const sourceId = getSourceId(scope);
  const request = {
    baseRevision: baselineState.handoffs[threadKey]?.revision ?? null,
    baseSelectedThreadRevision: baselineState.selectedThreadRevision,
    lastDeliberateActivityAt,
    lastSelectionActivityAt: normalizedLastSelectionActivityAt,
    sourceId,
    departureId,
    threadKey,
    selectedThreadKey,
    position,
  };
  const startedAt = Date.now();
  const initiatedAtServer = estimateServerTimeBounds(scope, startedAt);
  writePendingDepartureReceipt({
    version: 1,
    serverId: currentServerId(),
    sessionId: input.sessionId,
    threadKey,
    selectedThreadKey,
    sourceId,
    departureId,
    baseRevision: request.baseRevision,
    baseSelectedThreadRevision: request.baseSelectedThreadRevision,
    lastDeliberateActivityAt: request.lastDeliberateActivityAt,
    lastSelectionActivityAt: request.lastSelectionActivityAt,
    position,
    initiatedAtLocal: startedAt,
    initiatedAtServerLower: initiatedAtServer.lower,
    initiatedAtServerUpper: initiatedAtServer.upper,
  });

  let recentDeparture: RecentDeparture;
  const promise = putViewportHandoff(input.sessionId, request, {
    keepalive: input.keepalive,
    signal: input.signal,
  })
    .then((response) => {
      recordClockSample(scope, startedAt, Date.now(), response.serverNow);
      updateBaselineFromWrite(scope, input.sessionId, response);
      clearPendingDepartureReceipt(input.sessionId, threadKey, departureId);
      emitChange();
      return response;
    })
    .catch((error: unknown) => {
      state.lastPublishSkip = errorMessage(error);
      const recent = state.recentDepartures.get(threadKey);
      if (recent?.departureId === departureId) state.recentDepartures.delete(threadKey);
      emitChange();
      return null;
    })
    .finally(() => {
      recentDeparture.settled = true;
    });
  recentDeparture = { fingerprint, departureId, promise, settled: false };
  state.recentDepartures.set(threadKey, recentDeparture);
  return promise;
}

registerViewportHandoffPublisher(
  (sessionId, threadKey, position, options) => publishViewportHandoff(sessionId, threadKey, position, options),
  (sessionId, threadKey) =>
    useStore.getState().feedScrollPosition.get(getFeedViewportKey(sessionId, threadKey)) ??
    readLeaderViewportPosition(sessionId, threadKey),
);

export function getViewportHandoffSessionEntryState(sessionId: string): ViewportHandoffSessionState | null {
  return getSessionClientState(sessionId).sessionRead.value;
}

export function getViewportHandoffThreadEntryRecord(
  sessionId: string,
  threadKey: string,
): ViewportHandoffRecord | null {
  const normalizedThreadKey = normalizeViewportHandoffThreadKey(threadKey);
  if (!normalizedThreadKey) return null;
  return getSessionClientState(sessionId).threadReads.get(normalizedThreadKey)?.value ?? null;
}

export function getViewportHandoffBaselineState(sessionId: string): ViewportHandoffSessionState | null {
  return getSessionClientState(sessionId).baselineState;
}

export function getViewportHandoffSessionEntryStatus(sessionId: string, entryId?: string): ViewportHandoffEntryStatus {
  const entry = getSessionClientState(sessionId).sessionRead;
  if (!entryId) return entry.status;
  if (entry.pendingEntryIds.has(entryId) || entry.queuedPromises.has(entryId)) return "loading";
  if (!entry.settledEntryIds.has(entryId)) return "idle";
  return entry.status;
}

export function getViewportHandoffThreadEntryStatus(
  sessionId: string,
  threadKey: string,
  entryId?: string,
): ViewportHandoffEntryStatus {
  const normalizedThreadKey = normalizeViewportHandoffThreadKey(threadKey);
  if (!normalizedThreadKey) return "failed";
  const entry = getSessionClientState(sessionId).threadReads.get(normalizedThreadKey);
  if (!entry) return "idle";
  if (!entryId) return entry.status;
  if (entry.pendingEntryIds.has(entryId) || entry.queuedPromises.has(entryId)) return "loading";
  if (!entry.settledEntryIds.has(entryId)) return "idle";
  return entry.status;
}

export function subscribeViewportHandoffClient(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getViewportHandoffClientVersion(): number {
  return clientVersion;
}

export function inspectViewportHandoffClientForTest(sessionId?: string): unknown {
  const scope = currentServerScope();
  const prefix = `${scope}\u0000`;
  const entries = [...sessionStates.entries()]
    .filter(([key]) => key.startsWith(prefix) && (!sessionId || key.slice(prefix.length) === sessionId))
    .map(([key, state]) => ({
      sessionId: key.slice(prefix.length),
      sessionStatus: state.sessionRead.status,
      sessionEntryId: state.sessionRead.entryId,
      sessionEntryRevision: state.sessionRead.value?.revision ?? null,
      baselineRevision: state.baselineState?.revision ?? null,
      successfulFullRead: state.successfulFullRead,
      successfulThreadReads: [...state.successfulThreadReads],
      threadEntries: [...state.threadReads.entries()].map(([threadKey, entry]) => ({
        threadKey,
        status: entry.status,
        entryId: entry.entryId,
        entryRevision: entry.value?.revision ?? null,
        baselineRevision: state.baselineState?.handoffs[threadKey]?.revision ?? null,
      })),
      deliberateActivity: [...state.deliberateActivity.entries()],
      selectionActivity: state.selectionActivity,
      pendingDepartures: [...state.recentDepartures.entries()].map(([threadKey, departure]) => ({
        threadKey,
        departureId: departure.departureId,
        settled: departure.settled,
      })),
      lastPublishSkip: state.lastPublishSkip,
    }));
  return {
    identity: {
      scope,
      browserId: getBrowserId(scope),
      pageId: getPageId(scope),
      sourceId: getSourceId(scope),
    },
    clockEstimate: clockEstimates.has(scope) ? { ...clockEstimates.get(scope)! } : null,
    sessions: entries,
  };
}

export function resetViewportHandoffClientForTest(
  options: { preserveBrowserIdentity?: boolean; preservePendingDepartures?: boolean } = {},
): void {
  sessionStates.clear();
  pageIds.clear();
  fallbackBrowserIds.clear();
  clockEstimates.clear();
  activeServerScope = null;
  clientVersion = 0;
  if (typeof window !== "undefined") {
    try {
      const keys: string[] = [];
      for (let index = 0; index < window.sessionStorage.length; index++) {
        const key = window.sessionStorage.key(index);
        if (!key) continue;
        if (!options.preserveBrowserIdentity && key.startsWith(`${BROWSER_ID_KEY_PREFIX}:`)) keys.push(key);
        if (!options.preservePendingDepartures && key.startsWith(`${PENDING_DEPARTURE_KEY_PREFIX}:`)) keys.push(key);
      }
      for (const key of new Set(keys)) window.sessionStorage.removeItem(key);
    } catch {
      // Tests and constrained browser contexts may not expose sessionStorage.
    }
  }
}
