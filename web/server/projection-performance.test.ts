import { describe, expect, it } from "vitest";
import { buildLeaderActivePhaseSummary } from "../shared/leader-active-phase-summary.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SESSION_NAVIGATION_PROJECTION } from "../shared/session-navigation-projection.js";
import {
  clearAttentionAndMarkRead,
  countPendingUserPermissions,
  getNotificationStatusSnapshot,
  getSessionActivitySnapshot,
  getUserVisibleSessionNotifications,
  notifyUser,
  summarizePendingPermissions,
} from "./bridge/session-registry-controller.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import type { BrowserIncomingMessage, BoardRow } from "./session-types.js";
import type { SyncedProjectionRuntimeProjectionMetrics } from "./synced-projection-runtime.js";
import { WsBridge, type SocketData } from "./ws-bridge.js";

/**
 * Frozen pre-migration controls keep later cleanup from silently redefining
 * the retained historical payloads that constitute "before".
 */
export const PROJECTION_PERFORMANCE_CONTROL_COMMITS = {
  sessionNavigation: "12b08e56dd321d5cd7138cf5e57ee42eb8796f7d",
  sessionAttention: "0e5c6eb2e1f49856d48e57556de260b5984f8d2f",
  leaderThreadTabs: "6b50d3bd51b3782540016f02dc76576e5b70281d",
} as const;

export const PROJECTION_PERFORMANCE_FIXTURE = {
  sessionCount: 24,
  leaderCount: 1,
  leaderTabCount: 12,
  browserCount: 2,
  burstInvalidations: 25,
} as const;

const METRIC_KEYS = [
  "invalidations",
  "batches",
  "dependencySelections",
  "dependencyEqualSuppressions",
  "derivations",
  "equalValueSuppressions",
  "updates",
  "snapshots",
  "subscriptionsAccepted",
  "subscriptionsRejected",
  "valueBytes",
  "cachedValueBytes",
  "snapshotValueBytes",
  "updateValueBytes",
  "deliveries",
  "deliveredValueBytes",
] as const satisfies readonly (keyof SyncedProjectionRuntimeProjectionMetrics)[];

type MetricKey = (typeof METRIC_KEYS)[number];
type MetricSample = Pick<SyncedProjectionRuntimeProjectionMetrics, MetricKey>;

type CapturingSocket = {
  data: SocketData;
  readyState: number;
  sent: string[];
  send: (raw: unknown) => number;
};

interface ProjectionFixture {
  bridge: WsBridge;
  leader: Session;
  worker: Session;
}

interface ScenarioResult {
  metrics: MetricSample;
  messagesPerBrowser: number;
  requiredWireBytesPerBrowser: number;
  requiredWireBytesTotal: number;
}

interface AttentionTrafficSample {
  logicalSends: number;
  deliveries: number;
  bytesByBrowser: [number, number];
  totalBytes: number;
}

interface HistoricalAttentionControl {
  exactOwnerInbox: AttentionTrafficSample;
  ownerPermissionDetail: AttentionTrafficSample;
  fullGlobalSummary: AttentionTrafficSample;
  rawAttentionSessionUpdate: AttentionTrafficSample;
  combined: AttentionTrafficSample;
}

interface AttentionScenarioResult {
  metrics: MetricSample;
  exactOwnerInbox: AttentionTrafficSample;
  ownerPermissionDetail: AttentionTrafficSample;
  compactGlobalSummary: AttentionTrafficSample;
  projection: AttentionTrafficSample;
  forbidden: {
    observerInboxDeliveries: number;
    observerPermissionDeliveries: number;
    rawAttentionSessionUpdateDeliveries: number;
    globalSummariesWithLegacyAttentionOrPermissionFields: number;
  };
  combinedRequiredBytes: number;
  historicalControl: HistoricalAttentionControl;
}

interface ExecutedControlSequenceAccounting {
  producerFrames: number;
  sourceAssemblies: number;
  payloadAssemblies: number;
  logicalSends: number;
  deliveries: number;
  subscriptionRequests: 0;
  subscriptionsAccepted: 0;
  payloadBytesPerProducerFrame: number;
  payloadBytesByTypePerProducerFrame: Record<string, number>;
  bytesPerBrowser: number;
  totalBytes: number;
}

interface MatchedCompatiblePairAccounting {
  producerFrames: number;
  parallel: ExecutedControlSequenceAccounting;
  projection: {
    sourceAssemblies: number;
    payloadAssemblies: number;
    logicalSends: number;
    deliveries: number;
    bytesPerBrowser: number;
    totalBytes: number;
    runtimeMetrics: MetricSample;
  };
  combined: {
    logicalSends: number;
    deliveries: number;
    bytesPerBrowser: number;
    totalBytes: number;
    subscriptionRequests: 0;
    subscriptionsAccepted: 0;
  };
}

export interface ProjectionPerformanceResults {
  controlCommits: typeof PROJECTION_PERFORMANCE_CONTROL_COMMITS;
  historicalControlBasis: {
    method: "retained-current-executable-payload-assembly";
    limitation: string;
  };
  fixture: typeof PROJECTION_PERFORMANCE_FIXTURE;
  sessionAttention: {
    initialProjectionSubscriptionResponseBytesPerBrowser: number;
    initialProjectionSubscriptionMetrics: MetricSample;
    equalInvalidation: AttentionScenarioResult;
    firstNeedsInput: AttentionScenarioResult;
    firstReview: AttentionScenarioResult;
    sameUrgencyCountChange: AttentionScenarioResult;
    burstNeedsInput: AttentionScenarioResult;
    explicitReadClear: AttentionScenarioResult;
    permissionChange: AttentionScenarioResult;
    reconnect: {
      metrics: MetricSample;
      projectionSubscriptionResponseMessages: number;
      projectionSubscriptionResponseBytes: number;
    };
    noSubscriber: AttentionScenarioResult;
  };
  sessionNavigation: {
    bytes: {
      historicalLegacyStatusActivity: number;
      retainedParallelActivityResidual: number;
      requiredProjectionStatusUpdate: number;
      matchedCompatiblePairStatusChange: number;
    };
    /** Projection snapshots plus ack only; excludes the normal state_snapshot. */
    initialProjectionSubscriptionResponseBytesPerBrowser: number;
    initialProjectionSubscriptionMetrics: MetricSample;
    historicalControlSequences: {
      noOp: ExecutedControlSequenceAccounting;
      singleStatusChange: ExecutedControlSequenceAccounting;
      burstStatusChange: ExecutedControlSequenceAccounting;
    };
    matchedCompatiblePairSequences: {
      noOp: MatchedCompatiblePairAccounting;
      singleStatusChange: MatchedCompatiblePairAccounting;
      burstStatusChange: MatchedCompatiblePairAccounting;
    };
    /** Isolated synchronized runtime only; excludes retained parallel payloads. */
    noOp: ScenarioResult;
    singleChange: ScenarioResult;
    burstChange: ScenarioResult;
    reconnect: {
      metrics: MetricSample;
      projectionSubscriptionResponseMessages: number;
      /** Projection snapshot plus ack only; excludes the normal state_snapshot. */
      projectionSubscriptionResponseBytes: number;
    };
    noSubscriber: MetricSample;
  };
  leaderThreadTabs: {
    boardProducerProjectionOwnership: {
      sessionNavigationSubscribed: true;
      sessionAttentionSubscribed: true;
      note: string;
    };
    bytes: {
      subscribedParallelBoardActivityResidual: number;
      parallelBoardDetailLegacyPayload: number;
      requiredProjectionPhaseChange: number;
      matchedCompatiblePairPhaseChange: number;
      confirmedRemovableLegacyThreadStatusPayload: number;
      requiredProjectionStatusUpdate: number;
      matchedCompatiblePairStatusChange: number;
    };
    /** Projection snapshots plus ack only; excludes the normal state_snapshot. */
    initialProjectionSubscriptionResponseBytesPerBrowser: number;
    initialProjectionSubscriptionMetrics: MetricSample;
    historicalControlSequences: {
      noOp: ExecutedControlSequenceAccounting;
      singlePhaseChange: ExecutedControlSequenceAccounting;
      burstPhaseChange: ExecutedControlSequenceAccounting;
    };
    matchedCompatiblePairSequences: {
      noOp: MatchedCompatiblePairAccounting;
      singlePhaseChange: MatchedCompatiblePairAccounting;
      burstPhaseChange: MatchedCompatiblePairAccounting;
    };
    /** Isolated synchronized runtime only; excludes retained parallel payloads. */
    noOp: ScenarioResult;
    singleChange: ScenarioResult;
    burstChange: ScenarioResult;
    phaseChange: ScenarioResult;
    reconnect: {
      metrics: MetricSample;
      projectionSubscriptionResponseMessages: number;
      /** Projection snapshot plus ack only; excludes the normal state_snapshot. */
      projectionSubscriptionResponseBytes: number;
    };
    noSubscriber: {
      targetedQuestInvalidations: number;
      targetedQuestMetrics: MetricSample;
      genericPersistenceMetrics: MetricSample;
    };
  };
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
}

function socket(sessionId: string): CapturingSocket {
  return {
    data: { kind: "browser", sessionId },
    readyState: 1,
    sent: [],
    send(raw) {
      this.sent.push(String(raw));
      return 1;
    },
  };
}

function clearSockets(...sockets: CapturingSocket[]): void {
  for (const target of sockets) target.sent.length = 0;
}

function socketBytes(target: CapturingSocket): number {
  return target.sent.reduce((total, raw) => total + utf8Bytes(raw), 0);
}

function executeHistoricalControlSequence(
  producerFrames: number,
  buildPayloads: (frame: number) => BrowserIncomingMessage | BrowserIncomingMessage[],
): ExecutedControlSequenceAccounting {
  const browsers = Array.from({ length: PROJECTION_PERFORMANCE_FIXTURE.browserCount }, (_, index) =>
    socket(`historical-control-${index + 1}`),
  );
  let payloadsPerFrame: number | null = null;
  let payloadBytesByTypePerProducerFrame: Record<string, number> | null = null;

  for (let frame = 0; frame < producerFrames; frame += 1) {
    // These builder calls are the executable retained source/payload assemblies.
    // They deliberately do not import or execute the historical commit binary.
    const builtPayloads = buildPayloads(frame);
    const payloads = Array.isArray(builtPayloads) ? builtPayloads : [builtPayloads];
    const frameBytesByType: Record<string, number> = {};
    for (const payload of payloads) {
      const raw = JSON.stringify(payload);
      frameBytesByType[payload.type] = (frameBytesByType[payload.type] ?? 0) + utf8Bytes(raw);
      for (const browser of browsers) browser.send(raw);
    }
    payloadsPerFrame ??= payloads.length;
    payloadBytesByTypePerProducerFrame ??= frameBytesByType;
    if (
      payloads.length !== payloadsPerFrame ||
      JSON.stringify(frameBytesByType) !== JSON.stringify(payloadBytesByTypePerProducerFrame)
    ) {
      throw new Error("Historical control sequence must use deterministic payload assemblies");
    }
  }

  const bytesPerBrowser = socketBytes(browsers[0]);
  if (browsers.some((browser) => socketBytes(browser) !== bytesPerBrowser)) {
    throw new Error("Historical control fanout must deliver identical bytes to every browser");
  }
  const assemblies = producerFrames * (payloadsPerFrame ?? 0);
  const payloadBytesPerProducerFrame = Object.values(payloadBytesByTypePerProducerFrame ?? {}).reduce(
    (total, bytes) => total + bytes,
    0,
  );
  return {
    producerFrames,
    sourceAssemblies: assemblies,
    payloadAssemblies: assemblies,
    logicalSends: assemblies,
    deliveries: assemblies * browsers.length,
    subscriptionRequests: 0,
    subscriptionsAccepted: 0,
    payloadBytesPerProducerFrame,
    payloadBytesByTypePerProducerFrame: payloadBytesByTypePerProducerFrame ?? {},
    bytesPerBrowser,
    totalBytes: bytesPerBrowser * browsers.length,
  };
}

function rawMessagesMatching(
  target: CapturingSocket,
  predicate: (message: Record<string, unknown>) => boolean,
): string[] {
  return target.sent.filter((raw) => predicate(JSON.parse(raw) as Record<string, unknown>));
}

function matchedPairAccounting(params: {
  producerFrames: number;
  browsers: CapturingSocket[];
  parallelPredicate: (message: Record<string, unknown>) => boolean;
  projection: string;
  runtimeMetrics: MetricSample;
}): MatchedCompatiblePairAccounting {
  const parallelByBrowser = params.browsers.map((browser) => rawMessagesMatching(browser, params.parallelPredicate));
  const projectionByBrowser = params.browsers.map((browser) =>
    rawMessagesMatching(
      browser,
      (message) => message.type === "synced_projection_update" && message.projection === params.projection,
    ),
  );
  const parallelBytesPerBrowser = parallelByBrowser[0]?.reduce((total, raw) => total + utf8Bytes(raw), 0) ?? 0;
  const projectionBytesPerBrowser = projectionByBrowser[0]?.reduce((total, raw) => total + utf8Bytes(raw), 0) ?? 0;
  if (
    parallelByBrowser.some(
      (messages) => messages.reduce((total, raw) => total + utf8Bytes(raw), 0) !== parallelBytesPerBrowser,
    ) ||
    projectionByBrowser.some(
      (messages) => messages.reduce((total, raw) => total + utf8Bytes(raw), 0) !== projectionBytesPerBrowser,
    )
  ) {
    throw new Error("Matched-pair fanout must deliver identical bytes to every browser");
  }

  const parallelLogicalSends = parallelByBrowser[0]?.length ?? 0;
  const projectionLogicalSends = projectionByBrowser[0]?.length ?? 0;
  const parallelDeliveries = parallelByBrowser.reduce((total, messages) => total + messages.length, 0);
  const projectionDeliveries = projectionByBrowser.reduce((total, messages) => total + messages.length, 0);
  const parallelBytesByType = (parallelByBrowser[0] ?? []).reduce<Record<string, number>>((totals, raw) => {
    const message = JSON.parse(raw) as { type?: string };
    const type = message.type ?? "unknown";
    totals[type] = (totals[type] ?? 0) + utf8Bytes(raw);
    return totals;
  }, {});
  const parallel: ExecutedControlSequenceAccounting = {
    producerFrames: params.producerFrames,
    sourceAssemblies: parallelLogicalSends,
    payloadAssemblies: parallelLogicalSends,
    logicalSends: parallelLogicalSends,
    deliveries: parallelDeliveries,
    subscriptionRequests: 0,
    subscriptionsAccepted: 0,
    payloadBytesPerProducerFrame: params.producerFrames > 0 ? parallelBytesPerBrowser / params.producerFrames : 0,
    payloadBytesByTypePerProducerFrame: Object.fromEntries(
      Object.entries(parallelBytesByType).map(([type, bytes]) => [type, bytes / params.producerFrames]),
    ),
    bytesPerBrowser: parallelBytesPerBrowser,
    totalBytes: parallelBytesPerBrowser * params.browsers.length,
  };
  return {
    producerFrames: params.producerFrames,
    parallel,
    projection: {
      sourceAssemblies: params.runtimeMetrics.dependencySelections,
      payloadAssemblies: params.runtimeMetrics.updates,
      logicalSends: projectionLogicalSends,
      deliveries: projectionDeliveries,
      bytesPerBrowser: projectionBytesPerBrowser,
      totalBytes: projectionBytesPerBrowser * params.browsers.length,
      runtimeMetrics: params.runtimeMetrics,
    },
    combined: {
      logicalSends: parallelLogicalSends + projectionLogicalSends,
      deliveries: parallelDeliveries + projectionDeliveries,
      bytesPerBrowser: parallelBytesPerBrowser + projectionBytesPerBrowser,
      totalBytes: (parallelBytesPerBrowser + projectionBytesPerBrowser) * params.browsers.length,
      subscriptionRequests: 0,
      subscriptionsAccepted: 0,
    },
  };
}

function projectionMetrics(fixture: ProjectionFixture, projection: string): SyncedProjectionRuntimeProjectionMetrics {
  const metrics = fixture.bridge.getSyncedProjectionController().getMetrics().projections[projection];
  if (!metrics) throw new Error(`Missing projection metrics for ${projection}`);
  return metrics;
}

function metricDelta(
  before: SyncedProjectionRuntimeProjectionMetrics,
  after: SyncedProjectionRuntimeProjectionMetrics,
): MetricSample {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, after[key] - before[key]])) as MetricSample;
}

function zeroMetrics(): MetricSample {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as MetricSample;
}

function subscribe(
  fixture: ProjectionFixture,
  target: CapturingSocket,
  projection: string,
  key: string,
): BrowserIncomingMessage[] {
  return fixture.bridge
    .getSyncedProjectionController()
    .replaceSubscriptions(target as never, [{ projection, key }]) as BrowserIncomingMessage[];
}

function currentProjectionValueBytes(fixture: ProjectionFixture, projection: string): number {
  return projectionMetrics(fixture, projection).cachedValueBytes;
}

function makeFixture(): ProjectionFixture {
  const bridge = new WsBridge();
  const launcherSessions = new Map<string, Record<string, unknown>>();
  bridge.launcher = {
    getSession: (sessionId: string) => launcherSessions.get(sessionId),
    getSessionNum: (sessionId: string) => launcherSessions.get(sessionId)?.sessionNum,
    listSessions: () => [...launcherSessions.values()],
    setLastUserMessageAt: (sessionId: string, timestamp: number | undefined) => {
      const session = launcherSessions.get(sessionId);
      if (session) session.lastUserMessageAt = timestamp;
    },
  } as never;
  bridge.sessionNameGetter = (sessionId) => `Session ${sessionId}`;
  bridge.sessionStoredNameGetter = bridge.sessionNameGetter;
  bridge.timerManager = { listTimers: () => [] } as never;

  for (let index = 0; index < PROJECTION_PERFORMANCE_FIXTURE.sessionCount; index += 1) {
    const id = index === 0 ? "leader" : `worker-${index}`;
    const backendType = index % 2 === 0 ? "claude" : "codex";
    launcherSessions.set(id, {
      sessionId: id,
      state: "connected",
      cwd: `/repo/${id}`,
      repoRoot: "/repo",
      createdAt: 1_700_000_000_000 + index,
      sessionNum: index + 1,
      backendType,
      isOrchestrator: index === 0,
      archived: false,
      lastActivityAt: 1_700_000_100_000 + index,
    });
    const session = bridge.getOrCreateSession(id, backendType);
    session.state.model = backendType === "codex" ? "gpt-5.6" : "opus";
    session.state.cwd = `/repo/${id}`;
    session.state.repo_root = "/repo";
    session.state.git_branch = `branch-${index}`;
    session.state.permissionMode = "default";
    session.state.context_used_percent = 35;
    session.state.message_history_bytes = 12_000;
    session.state.claimedQuestId = index === 0 ? undefined : `q-${2_000 + index}`;
    session.state.claimedQuestTitle = index === 0 ? undefined : `Quest ${index}`;
    session.state.claimedQuestStatus = index === 0 ? undefined : "in_progress";
    session.lastUserMessage = `Representative message preview ${index}`;
    session.messageHistory.push({
      type: "user_message",
      content: session.lastUserMessage,
      timestamp: 1_700_000_000_100 + index,
    } as BrowserIncomingMessage);
  }

  const leader = bridge.getOrCreateSession("leader");
  leader.state.isOrchestrator = true;
  const orderedOpenThreadKeys: string[] = [];
  for (let index = 1; index <= PROJECTION_PERFORMANCE_FIXTURE.leaderTabCount; index += 1) {
    const questId = `q-${1_900 + index}`;
    orderedOpenThreadKeys.push(questId);
    const status = index <= 6 ? "WORKING" : index <= 8 ? "QUEUED" : index <= 10 ? "PROPOSED" : "MEMORY";
    const row: BoardRow = {
      questId,
      title: `Representative quest title ${index}`,
      status,
      createdAt: 1_000 + index,
      updatedAt: 2_000 + index,
      worker: `worker-${index}`,
      workerNum: index + 1,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        activePhaseIndex: status === "WORKING" ? 1 : 0,
        currentPhaseId: status === "WORKING" ? "work" : "alignment",
      },
    };
    if (index <= 10) leader.board.set(questId, row);
    else leader.completedBoard.set(questId, { ...row, completedAt: 3_000 + index });
  }
  leader.state.leaderOpenThreadTabs = {
    version: 1,
    orderedOpenThreadKeys,
    closedThreadTombstones: [],
    updatedAt: 2_000,
  };
  leader.state.leaderThreadStatuses = {
    "q-1903": {
      kind: "waiting",
      label: "Thread Waiting",
      threadKey: "q-1903",
      summary: "waiting for bounded benchmark",
      messageId: "message-1",
      timestamp: 2_100,
      updatedAt: 2_100,
    },
  };
  leader.notifications.push({
    id: "notification-1",
    messageId: "notification-message-1",
    category: "needs-input",
    summary: "Need a decision",
    timestamp: 2_200,
    threadKey: "q-1901",
    questId: "q-1901",
    done: false,
  });

  return { bridge, leader, worker: bridge.getOrCreateSession("worker-1") };
}

function historicalNavigationControl(
  fixture: ProjectionFixture,
): Extract<BrowserIncomingMessage, { type: "session_activity_update" }> {
  // At 12b08e56, global navigation freshness used this full activity message.
  // The current compatible pair still retains non-navigation notification and
  // activity fields from this producer after projection-owned fields are removed.
  return {
    type: "session_activity_update",
    session_id: fixture.worker.id,
    session: {
      attentionReason: fixture.worker.attentionReason ?? null,
      lastReadAt: fixture.worker.lastReadAt,
      pendingPermissionCount: countPendingUserPermissions(fixture.worker),
      pendingPermissionSummary: summarizePendingPermissions(fixture.worker),
      ...getSessionActivitySnapshot(fixture.worker),
      status: "running",
    } as never,
  };
}

function historicalLeaderBoardControl(fixture: ProjectionFixture): BrowserIncomingMessage {
  // At 6b50d3bd, board changes carried all tab inputs through board_updated and
  // the browser rebuilt compact tabs locally. The current pair still needs the
  // detailed board/completed-board/row authorities in this parallel payload,
  // even though some compact projection-owned presentation fields overlap.
  const board = [...fixture.leader.board.values()];
  const completedBoard = [...fixture.leader.completedBoard.values()];
  return {
    type: "board_updated",
    board,
    completedBoard,
    leaderOpenThreadTabs: fixture.leader.state.leaderOpenThreadTabs,
    leaderActivePhaseSummary: buildLeaderActivePhaseSummary(board),
    rowSessionStatuses: {},
  } as BrowserIncomingMessage;
}

function currentLeaderBoardDetail(fixture: ProjectionFixture): BrowserIncomingMessage {
  return {
    type: "board_updated",
    board: [...fixture.leader.board.values()],
    completedBoard: [...fixture.leader.completedBoard.values()],
    rowSessionStatuses: {},
  } as BrowserIncomingMessage;
}

function subscribedLeaderBoardActivityResidual(
  fixture: ProjectionFixture,
): Extract<BrowserIncomingMessage, { type: "session_activity_update" }> {
  const board = [...fixture.leader.board.values()];
  const fullActivity: Extract<BrowserIncomingMessage, { type: "session_activity_update" }> = {
    type: "session_activity_update",
    session_id: fixture.leader.id,
    session: {
      attentionReason: fixture.leader.attentionReason ?? null,
      lastReadAt: fixture.leader.lastReadAt,
      pendingPermissionSummary: summarizePendingPermissions(fixture.leader),
      ...getSessionActivitySnapshot(fixture.leader),
      leaderActiveBoardRows: board,
      leaderActivePhaseSummary: buildLeaderActivePhaseSummary(board),
    } as never,
  };
  return fullActivity;
}

function historicalLeaderStatusControl(fixture: ProjectionFixture): BrowserIncomingMessage {
  // Thread marker changes at 6b50d3bd were partial session updates. Comparing
  // this control with a whole projected value exposes full-value coupling.
  return {
    type: "session_update",
    session: { leaderThreadStatuses: fixture.leader.state.leaderThreadStatuses },
  } as BrowserIncomingMessage;
}

function attachBrowserSocket(fixture: ProjectionFixture, target: CapturingSocket): void {
  const sessionId = (target.data as { sessionId: string }).sessionId;
  fixture.bridge.getOrCreateSession(sessionId).browserSockets.add(target as never);
}

function emptyAttentionTraffic(): AttentionTrafficSample {
  return { logicalSends: 0, deliveries: 0, bytesByBrowser: [0, 0], totalBytes: 0 };
}

function trafficSample(ownerRaw: string[], observerRaw: string[]): AttentionTrafficSample {
  const ownerBytes = ownerRaw.reduce((total, raw) => total + utf8Bytes(raw), 0);
  const observerBytes = observerRaw.reduce((total, raw) => total + utf8Bytes(raw), 0);
  return {
    logicalSends: Math.max(ownerRaw.length, observerRaw.length),
    deliveries: ownerRaw.length + observerRaw.length,
    bytesByBrowser: [ownerBytes, observerBytes],
    totalBytes: ownerBytes + observerBytes,
  };
}

function addHistoricalAttentionDelivery(
  traffic: AttentionTrafficSample,
  message: BrowserIncomingMessage,
  recipients: readonly [boolean, boolean],
): void {
  const bytes = utf8Bytes(message);
  traffic.logicalSends += 1;
  for (let index = 0; index < recipients.length; index += 1) {
    if (!recipients[index]) continue;
    traffic.deliveries += 1;
    traffic.bytesByBrowser[index] += bytes;
    traffic.totalBytes += bytes;
  }
}

function emptyHistoricalAttentionControl(): HistoricalAttentionControl {
  return {
    exactOwnerInbox: emptyAttentionTraffic(),
    ownerPermissionDetail: emptyAttentionTraffic(),
    fullGlobalSummary: emptyAttentionTraffic(),
    rawAttentionSessionUpdate: emptyAttentionTraffic(),
    combined: { logicalSends: 0, deliveries: 0, bytesByBrowser: [0, 0], totalBytes: 0 },
  };
}

function finalizeHistoricalAttention(control: HistoricalAttentionControl): HistoricalAttentionControl {
  const traffic = [
    control.exactOwnerInbox,
    control.ownerPermissionDetail,
    control.fullGlobalSummary,
    control.rawAttentionSessionUpdate,
  ];
  control.combined = {
    logicalSends: traffic.reduce((total, sample) => total + sample.logicalSends, 0),
    deliveries: traffic.reduce((total, sample) => total + sample.deliveries, 0),
    bytesByBrowser: [
      traffic.reduce((total, sample) => total + sample.bytesByBrowser[0], 0),
      traffic.reduce((total, sample) => total + sample.bytesByBrowser[1], 0),
    ],
    totalBytes: traffic.reduce((total, sample) => total + sample.totalBytes, 0),
  };
  return control;
}

function historicalAttentionInboxControl(fixture: ProjectionFixture): BrowserIncomingMessage {
  return {
    type: "notification_update",
    notifications: getUserVisibleSessionNotifications(fixture.worker),
    ...getNotificationStatusSnapshot(fixture.worker),
  } as BrowserIncomingMessage;
}

function historicalAttentionGlobalControl(fixture: ProjectionFixture): BrowserIncomingMessage {
  return {
    type: "session_activity_update",
    session_id: fixture.worker.id,
    session: {
      attentionReason: fixture.worker.attentionReason ?? null,
      lastReadAt: fixture.worker.lastReadAt,
      pendingPermissionCount: countPendingUserPermissions(fixture.worker),
      pendingPermissionSummary: summarizePendingPermissions(fixture.worker),
      ...getNotificationStatusSnapshot(fixture.worker),
    },
  } as BrowserIncomingMessage;
}

function historicalAttentionSessionUpdateControl(
  fixture: ProjectionFixture,
  includeLastReadAt = false,
): BrowserIncomingMessage {
  return {
    type: "session_update",
    session: {
      attentionReason: fixture.worker.attentionReason ?? null,
      ...(includeLastReadAt ? { lastReadAt: fixture.worker.lastReadAt } : {}),
    },
  } as BrowserIncomingMessage;
}

function appendHistoricalNotificationControl(
  fixture: ProjectionFixture,
  control: HistoricalAttentionControl,
  options: {
    globalSummarySends: number;
    rawAttentionSessionUpdates: number;
    includeLastReadAt?: boolean;
  },
): void {
  addHistoricalAttentionDelivery(control.exactOwnerInbox, historicalAttentionInboxControl(fixture), [true, false]);
  for (let index = 0; index < options.globalSummarySends; index += 1) {
    addHistoricalAttentionDelivery(control.fullGlobalSummary, historicalAttentionGlobalControl(fixture), [true, true]);
  }
  for (let index = 0; index < options.rawAttentionSessionUpdates; index += 1) {
    addHistoricalAttentionDelivery(
      control.rawAttentionSessionUpdate,
      historicalAttentionSessionUpdateControl(fixture, options.includeLastReadAt),
      [true, false],
    );
  }
}

function attentionNotificationDeps(fixture: ProjectionFixture) {
  return {
    isHerdedWorkerSession: () => false,
    getLauncherSessionInfo: (sessionId: string) => fixture.bridge.launcher?.getSession(sessionId),
    broadcastToBrowsers: (session: Session, message: BrowserIncomingMessage) =>
      fixture.bridge.broadcastToSession(session.id, message),
    persistSession: (session: Session) => fixture.bridge.persistSessionById(session.id),
    scheduleNotification: () => undefined,
  };
}

function makeAttentionFixture(subscribed = true): {
  fixture: ProjectionFixture;
  owner: CapturingSocket;
  observer: CapturingSocket;
} {
  const fixture = makeFixture();
  const owner = socket(fixture.worker.id);
  const observer = socket("attention-observer");
  attachBrowserSocket(fixture, owner);
  attachBrowserSocket(fixture, observer);
  if (subscribed) {
    subscribe(fixture, owner, SESSION_ATTENTION_PROJECTION, fixture.worker.id);
    subscribe(fixture, observer, SESSION_ATTENTION_PROJECTION, fixture.worker.id);
  }
  clearSockets(owner, observer);
  return { fixture, owner, observer };
}

function isLegacyAttentionSessionUpdate(message: Record<string, unknown>): boolean {
  if (message.type !== "session_update" || !message.session || typeof message.session !== "object") return false;
  const session = message.session as Record<string, unknown>;
  return "attentionReason" in session || "lastReadAt" in session;
}

function hasLegacyAttentionOrPermissionSummaryFields(message: Record<string, unknown>): boolean {
  if (message.type !== "session_activity_update" || !message.session || typeof message.session !== "object") {
    return false;
  }
  const session = message.session as Record<string, unknown>;
  return ["attentionReason", "lastReadAt", "pendingPermissionCount", "pendingPermissionSummary"].some(
    (field) => field in session,
  );
}

function collectAttentionScenario(
  fixture: ProjectionFixture,
  owner: CapturingSocket,
  observer: CapturingSocket,
  before: SyncedProjectionRuntimeProjectionMetrics,
  historicalControl: HistoricalAttentionControl,
): AttentionScenarioResult {
  const ownerInbox = rawMessagesMatching(owner, (message) => message.type === "notification_update");
  const observerInbox = rawMessagesMatching(observer, (message) => message.type === "notification_update");
  const ownerPermission = rawMessagesMatching(owner, (message) => message.type === "permission_request");
  const observerPermission = rawMessagesMatching(observer, (message) => message.type === "permission_request");
  const ownerGlobal = rawMessagesMatching(
    owner,
    (message) => message.type === "session_activity_update" && message.session_id === fixture.worker.id,
  );
  const observerGlobal = rawMessagesMatching(
    observer,
    (message) => message.type === "session_activity_update" && message.session_id === fixture.worker.id,
  );
  const ownerProjection = rawMessagesMatching(
    owner,
    (message) =>
      message.type === "synced_projection_update" &&
      message.projection === SESSION_ATTENTION_PROJECTION &&
      message.key === fixture.worker.id,
  );
  const observerProjection = rawMessagesMatching(
    observer,
    (message) =>
      message.type === "synced_projection_update" &&
      message.projection === SESSION_ATTENTION_PROJECTION &&
      message.key === fixture.worker.id,
  );
  const allMessages = [...owner.sent, ...observer.sent].map((raw) => JSON.parse(raw) as Record<string, unknown>);
  const exactOwnerInbox = trafficSample(ownerInbox, observerInbox);
  const ownerPermissionDetail = trafficSample(ownerPermission, observerPermission);
  const compactGlobalSummary = trafficSample(ownerGlobal, observerGlobal);
  const projection = trafficSample(ownerProjection, observerProjection);
  return {
    metrics: metricDelta(before, projectionMetrics(fixture, SESSION_ATTENTION_PROJECTION)),
    exactOwnerInbox,
    ownerPermissionDetail,
    compactGlobalSummary,
    projection,
    forbidden: {
      observerInboxDeliveries: observerInbox.length,
      observerPermissionDeliveries: observerPermission.length,
      rawAttentionSessionUpdateDeliveries: allMessages.filter(isLegacyAttentionSessionUpdate).length,
      globalSummariesWithLegacyAttentionOrPermissionFields: allMessages.filter(
        hasLegacyAttentionOrPermissionSummaryFields,
      ).length,
    },
    combinedRequiredBytes:
      exactOwnerInbox.totalBytes +
      ownerPermissionDetail.totalBytes +
      compactGlobalSummary.totalBytes +
      projection.totalBytes,
    historicalControl: finalizeHistoricalAttention(historicalControl),
  };
}

async function attentionEqualInvalidationScenario(): Promise<AttentionScenarioResult> {
  const { fixture, owner, observer } = makeAttentionFixture();
  const before = projectionMetrics(fixture, SESSION_ATTENTION_PROJECTION);
  fixture.bridge.getSyncedProjectionController().invalidateSession(fixture.worker);
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  return collectAttentionScenario(fixture, owner, observer, before, emptyHistoricalAttentionControl());
}

async function firstAttentionScenario(category: "needs-input" | "review"): Promise<AttentionScenarioResult> {
  const { fixture, owner, observer } = makeAttentionFixture();
  const before = projectionMetrics(fixture, SESSION_ATTENTION_PROJECTION);
  notifyUser(fixture.worker, category, `First ${category} notification`, attentionNotificationDeps(fixture));
  const historicalControl = emptyHistoricalAttentionControl();
  appendHistoricalNotificationControl(fixture, historicalControl, {
    globalSummarySends: 3,
    rawAttentionSessionUpdates: 2,
  });
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  return collectAttentionScenario(fixture, owner, observer, before, historicalControl);
}

async function sameUrgencyAttentionCountScenario(): Promise<AttentionScenarioResult> {
  const { fixture, owner, observer } = makeAttentionFixture();
  const deps = attentionNotificationDeps(fixture);
  notifyUser(fixture.worker, "review", "First review notification", deps);
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  clearSockets(owner, observer);

  const before = projectionMetrics(fixture, SESSION_ATTENTION_PROJECTION);
  notifyUser(fixture.worker, "review", "Second review notification", deps);
  const historicalControl = emptyHistoricalAttentionControl();
  appendHistoricalNotificationControl(fixture, historicalControl, {
    globalSummarySends: 2,
    rawAttentionSessionUpdates: 1,
  });
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  return collectAttentionScenario(fixture, owner, observer, before, historicalControl);
}

async function burstAttentionScenario(): Promise<AttentionScenarioResult> {
  const { fixture, owner, observer } = makeAttentionFixture();
  const deps = attentionNotificationDeps(fixture);
  const before = projectionMetrics(fixture, SESSION_ATTENTION_PROJECTION);
  const historicalControl = emptyHistoricalAttentionControl();
  for (let index = 0; index < PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations; index += 1) {
    notifyUser(fixture.worker, "needs-input", `Burst needs-input ${index + 1}`, deps);
    appendHistoricalNotificationControl(fixture, historicalControl, {
      globalSummarySends: index === 0 ? 3 : 2,
      rawAttentionSessionUpdates: index === 0 ? 2 : 1,
    });
  }
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  return collectAttentionScenario(fixture, owner, observer, before, historicalControl);
}

async function explicitAttentionReadClearScenario(): Promise<AttentionScenarioResult> {
  const { fixture, owner, observer } = makeAttentionFixture();
  const deps = attentionNotificationDeps(fixture);
  notifyUser(fixture.worker, "review", "Review before explicit read", deps);
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  clearSockets(owner, observer);

  const before = projectionMetrics(fixture, SESSION_ATTENTION_PROJECTION);
  clearAttentionAndMarkRead(fixture.worker, deps);
  const historicalControl = emptyHistoricalAttentionControl();
  appendHistoricalNotificationControl(fixture, historicalControl, {
    globalSummarySends: 2,
    rawAttentionSessionUpdates: 1,
    includeLastReadAt: true,
  });
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  return collectAttentionScenario(fixture, owner, observer, before, historicalControl);
}

async function attentionPermissionScenario(): Promise<AttentionScenarioResult> {
  const { fixture, owner, observer } = makeAttentionFixture();
  const request = {
    request_id: "attention-permission-1",
    tool_name: "ExitPlanMode",
    input: { plan: "Use the canonical attention projection" },
    tool_use_id: "attention-tool-1",
    timestamp: 1_700_000_200_000,
  };
  fixture.worker.pendingPermissions.set(request.request_id, request);
  const before = projectionMetrics(fixture, SESSION_ATTENTION_PROJECTION);
  fixture.bridge.broadcastToSession(fixture.worker.id, { type: "permission_request", request });
  (
    fixture.bridge as unknown as { onSessionActivityStateChanged: (sessionId: string, reason: string) => void }
  ).onSessionActivityStateChanged(fixture.worker.id, "attention performance permission");

  const historicalControl = emptyHistoricalAttentionControl();
  addHistoricalAttentionDelivery(historicalControl.ownerPermissionDetail, { type: "permission_request", request }, [
    true,
    false,
  ]);
  addHistoricalAttentionDelivery(historicalControl.fullGlobalSummary, historicalAttentionGlobalControl(fixture), [
    true,
    true,
  ]);
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  return collectAttentionScenario(fixture, owner, observer, before, historicalControl);
}

async function attentionNoSubscriberScenario(): Promise<AttentionScenarioResult> {
  const { fixture, owner, observer } = makeAttentionFixture(false);
  const before = projectionMetrics(fixture, SESSION_ATTENTION_PROJECTION);
  notifyUser(fixture.worker, "needs-input", "No-subscriber needs input", attentionNotificationDeps(fixture));
  const historicalControl = emptyHistoricalAttentionControl();
  appendHistoricalNotificationControl(fixture, historicalControl, {
    globalSummarySends: 3,
    rawAttentionSessionUpdates: 2,
  });
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  return collectAttentionScenario(fixture, owner, observer, before, historicalControl);
}

function seedAttentionProjectionValue(fixture: ProjectionFixture): void {
  fixture.worker.notifications.push({
    id: "n-1",
    category: "needs-input",
    summary: "Cached attention notification",
    timestamp: 1_700_000_300_000,
    messageId: null,
    done: false,
  });
  fixture.worker.notificationCounter = 1;
  fixture.worker.notificationStatusVersion = 1;
  fixture.worker.notificationStatusUpdatedAt = 1_700_000_300_000;
  fixture.worker.attentionReason = "action";
}

async function matchedNavigationStatusSequence(options: {
  producerFrames: number;
  primeRunning?: boolean;
}): Promise<MatchedCompatiblePairAccounting> {
  const fixture = makeFixture();
  const browsers = [socket("navigation-matched-1"), socket("navigation-matched-2")];
  for (const browser of browsers) {
    attachBrowserSocket(fixture, browser);
    subscribe(fixture, browser, SESSION_NAVIGATION_PROJECTION, fixture.worker.id);
  }

  if (options.primeRunning) {
    fixture.bridge.broadcastToSession(fixture.worker.id, { type: "status_change", status: "running" });
    await fixture.bridge.getSyncedProjectionController().flushForTest();
  }
  clearSockets(...browsers);
  const before = projectionMetrics(fixture, SESSION_NAVIGATION_PROJECTION);
  for (let frame = 0; frame < options.producerFrames; frame += 1) {
    fixture.bridge.broadcastToSession(fixture.worker.id, { type: "status_change", status: "running" });
  }
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  const after = projectionMetrics(fixture, SESSION_NAVIGATION_PROJECTION);
  return matchedPairAccounting({
    producerFrames: options.producerFrames,
    browsers,
    parallelPredicate: (message) => message.type === "session_activity_update",
    projection: SESSION_NAVIGATION_PROJECTION,
    runtimeMetrics: metricDelta(before, after),
  });
}

async function matchedLeaderBoardSequence(options: {
  producerFrames: number;
  phaseChange?: boolean;
}): Promise<MatchedCompatiblePairAccounting> {
  const fixture = makeFixture();
  const browsers = [socket("leader-matched-1"), socket("leader-matched-2")];
  for (const browser of browsers) {
    fixture.bridge.getSyncedProjectionController().replaceSubscriptions(browser as never, [
      { projection: SESSION_ATTENTION_PROJECTION, key: fixture.leader.id },
      { projection: SESSION_NAVIGATION_PROJECTION, key: fixture.leader.id },
      { projection: LEADER_THREAD_TABS_PROJECTION, key: fixture.leader.id },
    ]);
    if (
      !fixture.bridge
        .getSyncedProjectionController()
        .hasSessionNavigationSubscription(browser as never, fixture.leader.id)
    ) {
      throw new Error("Matched leader browser must own the normal navigation subscription");
    }
  }
  clearSockets(...browsers);
  const before = projectionMetrics(fixture, LEADER_THREAD_TABS_PROJECTION);
  if (options.phaseChange) updateLeaderJourneyToMemory(fixture);

  for (let frame = 0; frame < options.producerFrames; frame += 1) {
    // Execute the retained board detail assembly and fanout once per producer
    // frame, then let the synchronized runtime coalesce its own invalidations.
    const boardRaw = JSON.stringify(currentLeaderBoardDetail(fixture));
    for (const browser of browsers) browser.send(boardRaw);
    expect(fixture.bridge.invalidateLeaderThreadTabsForQuestIds(["q-1901"])).toBe(1);
  }
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  const after = projectionMetrics(fixture, LEADER_THREAD_TABS_PROJECTION);
  return matchedPairAccounting({
    producerFrames: options.producerFrames,
    browsers,
    parallelPredicate: (message) => message.type === "board_updated",
    projection: LEADER_THREAD_TABS_PROJECTION,
    runtimeMetrics: metricDelta(before, after),
  });
}

async function navigationScenario(options: {
  invalidations: number;
  statusProducer?: "running";
}): Promise<ScenarioResult> {
  const fixture = makeFixture();
  const first = socket("navigation-carrier-1");
  const second = socket("navigation-carrier-2");
  subscribe(fixture, first, SESSION_NAVIGATION_PROJECTION, fixture.worker.id);
  subscribe(fixture, second, SESSION_NAVIGATION_PROJECTION, fixture.worker.id);
  clearSockets(first, second);
  const before = projectionMetrics(fixture, SESSION_NAVIGATION_PROJECTION);
  for (let index = 0; index < options.invalidations; index += 1) {
    if (options.statusProducer) {
      // Drive the same status_change producer that authored the historical
      // session_activity_update control instead of mutating projection state.
      fixture.bridge.broadcastToSession(fixture.worker.id, {
        type: "status_change",
        status: options.statusProducer,
      });
    } else {
      fixture.bridge.getSyncedProjectionController().invalidateSessionNavigation(fixture.worker);
    }
  }
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  const after = projectionMetrics(fixture, SESSION_NAVIGATION_PROJECTION);
  return {
    metrics: metricDelta(before, after),
    messagesPerBrowser: first.sent.length,
    requiredWireBytesPerBrowser: socketBytes(first),
    requiredWireBytesTotal: socketBytes(first) + socketBytes(second),
  };
}

async function leaderScenario(options: {
  mutate?: (fixture: ProjectionFixture) => void;
  invalidations: number;
}): Promise<ScenarioResult> {
  const fixture = makeFixture();
  const first = socket("leader-carrier-1");
  const second = socket("leader-carrier-2");
  subscribe(fixture, first, LEADER_THREAD_TABS_PROJECTION, fixture.leader.id);
  subscribe(fixture, second, LEADER_THREAD_TABS_PROJECTION, fixture.leader.id);
  clearSockets(first, second);
  const before = projectionMetrics(fixture, LEADER_THREAD_TABS_PROJECTION);
  options.mutate?.(fixture);
  for (let index = 0; index < options.invalidations; index += 1) {
    expect(fixture.bridge.invalidateLeaderThreadTabsForQuestIds(["q-1903"])).toBe(1);
  }
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  const after = projectionMetrics(fixture, LEADER_THREAD_TABS_PROJECTION);
  return {
    metrics: metricDelta(before, after),
    messagesPerBrowser: first.sent.length,
    requiredWireBytesPerBrowser: socketBytes(first),
    requiredWireBytesTotal: socketBytes(first) + socketBytes(second),
  };
}

function updateLeaderStatus(fixture: ProjectionFixture, summary: string, updatedAt: number): void {
  const status = fixture.leader.state.leaderThreadStatuses?.["q-1903"];
  if (!status) throw new Error("Missing representative leader status");
  fixture.leader.state.leaderThreadStatuses = {
    ...fixture.leader.state.leaderThreadStatuses,
    "q-1903": { ...status, summary, updatedAt },
  };
}

function updateLeaderJourneyToMemory(fixture: ProjectionFixture): void {
  const row = fixture.leader.board.get("q-1901");
  if (!row) throw new Error("Missing representative q-1901 board row");
  fixture.leader.board.set("q-1901", {
    ...row,
    status: "MEMORY",
    updatedAt: 2_500,
    journey: {
      mode: "active",
      phaseIds: ["alignment", "work", "memory"],
      activePhaseIndex: 2,
      currentPhaseId: "memory",
    },
  });
}

async function leaderPhaseChangeScenario(): Promise<{
  scenario: ScenarioResult;
  subscribedParallelBoardActivityResidualBytes: number;
  parallelBoardDetailBytes: number;
}> {
  const fixture = makeFixture();
  const first = socket("leader-phase-carrier-1");
  const second = socket("leader-phase-carrier-2");
  subscribe(fixture, first, LEADER_THREAD_TABS_PROJECTION, fixture.leader.id);
  subscribe(fixture, second, LEADER_THREAD_TABS_PROJECTION, fixture.leader.id);
  clearSockets(first, second);
  const before = projectionMetrics(fixture, LEADER_THREAD_TABS_PROJECTION);

  // Use one mutated source for both sides of the comparison: the parallel
  // board_updated detail payload and synchronized projection observe the same
  // q-1901 Work -> Memory status and Journey transition.
  updateLeaderJourneyToMemory(fixture);
  const subscribedParallelBoardActivityResidualBytes = 0;
  const parallelBoardDetailBytes = utf8Bytes(currentLeaderBoardDetail(fixture));
  expect(fixture.bridge.invalidateLeaderThreadTabsForQuestIds(["q-1901"])).toBe(1);
  await fixture.bridge.getSyncedProjectionController().flushForTest();
  const after = projectionMetrics(fixture, LEADER_THREAD_TABS_PROJECTION);

  return {
    scenario: {
      metrics: metricDelta(before, after),
      messagesPerBrowser: first.sent.length,
      requiredWireBytesPerBrowser: socketBytes(first),
      requiredWireBytesTotal: socketBytes(first) + socketBytes(second),
    },
    subscribedParallelBoardActivityResidualBytes,
    parallelBoardDetailBytes,
  };
}

/**
 * Build the exact deterministic measurement object used by the assertions and
 * by the Work documentation. Invoke the focused test with
 * `TAKODE_PRINT_PROJECTION_PERFORMANCE=1` to emit compact JSON.
 */
export async function collectProjectionPerformanceResults(): Promise<ProjectionPerformanceResults> {
  const attentionInitialFixture = makeFixture();
  seedAttentionProjectionValue(attentionInitialFixture);
  const attentionInitialFirst = socket("attention-initial-1");
  const attentionInitialSecond = socket("attention-initial-2");
  const attentionBeforeInitialSubscription = projectionMetrics(attentionInitialFixture, SESSION_ATTENTION_PROJECTION);
  const attentionFirstResponse = subscribe(
    attentionInitialFixture,
    attentionInitialFirst,
    SESSION_ATTENTION_PROJECTION,
    attentionInitialFixture.worker.id,
  );
  subscribe(
    attentionInitialFixture,
    attentionInitialSecond,
    SESSION_ATTENTION_PROJECTION,
    attentionInitialFixture.worker.id,
  );
  const attentionAfterInitialSubscription = projectionMetrics(attentionInitialFixture, SESSION_ATTENTION_PROJECTION);
  const attentionInitialSubscriptionBytes = attentionFirstResponse.reduce(
    (total, message) => total + utf8Bytes(message),
    0,
  );

  const attentionEqualInvalidation = await attentionEqualInvalidationScenario();
  const attentionFirstNeedsInput = await firstAttentionScenario("needs-input");
  const attentionFirstReview = await firstAttentionScenario("review");
  const attentionSameUrgencyCountChange = await sameUrgencyAttentionCountScenario();
  const attentionBurstNeedsInput = await burstAttentionScenario();
  const attentionExplicitReadClear = await explicitAttentionReadClearScenario();
  const attentionPermissionChange = await attentionPermissionScenario();
  const attentionNoSubscriber = await attentionNoSubscriberScenario();

  attentionInitialFixture.bridge.getSyncedProjectionController().removeSubscriber(attentionInitialFirst as never);
  const attentionReconnect = socket("attention-reconnect");
  const attentionBeforeReconnect = projectionMetrics(attentionInitialFixture, SESSION_ATTENTION_PROJECTION);
  const attentionReconnectResponse = subscribe(
    attentionInitialFixture,
    attentionReconnect,
    SESSION_ATTENTION_PROJECTION,
    attentionInitialFixture.worker.id,
  );
  const attentionAfterReconnect = projectionMetrics(attentionInitialFixture, SESSION_ATTENTION_PROJECTION);

  const navigationInitialFixture = makeFixture();
  const navigationInitialFirst = socket("navigation-initial-1");
  const navigationInitialSecond = socket("navigation-initial-2");
  const navigationBeforeInitialSubscription = projectionMetrics(
    navigationInitialFixture,
    SESSION_NAVIGATION_PROJECTION,
  );
  const navigationFirstResponse = subscribe(
    navigationInitialFixture,
    navigationInitialFirst,
    SESSION_NAVIGATION_PROJECTION,
    navigationInitialFixture.worker.id,
  );
  subscribe(
    navigationInitialFixture,
    navigationInitialSecond,
    SESSION_NAVIGATION_PROJECTION,
    navigationInitialFixture.worker.id,
  );
  const navigationAfterInitialSubscription = projectionMetrics(navigationInitialFixture, SESSION_NAVIGATION_PROJECTION);
  const navigationInitialSubscriptionBytes = navigationFirstResponse.reduce(
    (total, message) => total + utf8Bytes(message),
    0,
  );

  const navigationNoOp = await navigationScenario({ invalidations: 1 });
  const navigationSingleChange = await navigationScenario({
    invalidations: 1,
    statusProducer: "running",
  });
  const navigationBurst = await navigationScenario({
    invalidations: PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations,
    statusProducer: "running",
  });

  const navigationReconnectFixture = makeFixture();
  const navigationPriorSocket = socket("navigation-prior");
  subscribe(
    navigationReconnectFixture,
    navigationPriorSocket,
    SESSION_NAVIGATION_PROJECTION,
    navigationReconnectFixture.worker.id,
  );
  navigationReconnectFixture.bridge.getSyncedProjectionController().removeSubscriber(navigationPriorSocket as never);
  const navigationReconnect = socket("navigation-reconnect");
  const navigationBeforeReconnect = projectionMetrics(navigationReconnectFixture, SESSION_NAVIGATION_PROJECTION);
  const navigationReconnectResponse = subscribe(
    navigationReconnectFixture,
    navigationReconnect,
    SESSION_NAVIGATION_PROJECTION,
    navigationReconnectFixture.worker.id,
  );
  const navigationAfterReconnect = projectionMetrics(navigationReconnectFixture, SESSION_NAVIGATION_PROJECTION);

  const navigationNoSubscriberFixture = makeFixture();
  const navigationBeforeNoSubscriber = projectionMetrics(navigationNoSubscriberFixture, SESSION_NAVIGATION_PROJECTION);
  navigationNoSubscriberFixture.bridge
    .getSyncedProjectionController()
    .invalidateSessionNavigation(navigationNoSubscriberFixture.worker);
  await navigationNoSubscriberFixture.bridge.getSyncedProjectionController().flushForTest();
  const navigationAfterNoSubscriber = projectionMetrics(navigationNoSubscriberFixture, SESSION_NAVIGATION_PROJECTION);

  const navigationControlFixture = makeFixture();
  const navigationLegacyControl = historicalNavigationControl(navigationControlFixture);
  const navigationHistoricalNoOpFixture = makeFixture();
  const navigationHistoricalSingleFixture = makeFixture();
  const navigationHistoricalBurstFixture = makeFixture();
  const navigationHistoricalControlSequences = {
    noOp: executeHistoricalControlSequence(1, () => historicalNavigationControl(navigationHistoricalNoOpFixture)),
    singleStatusChange: executeHistoricalControlSequence(1, () =>
      historicalNavigationControl(navigationHistoricalSingleFixture),
    ),
    burstStatusChange: executeHistoricalControlSequence(PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations, () =>
      historicalNavigationControl(navigationHistoricalBurstFixture),
    ),
  };
  const navigationMatchedCompatiblePairSequences = {
    noOp: await matchedNavigationStatusSequence({ producerFrames: 1, primeRunning: true }),
    singleStatusChange: await matchedNavigationStatusSequence({ producerFrames: 1 }),
    burstStatusChange: await matchedNavigationStatusSequence({
      producerFrames: PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations,
    }),
  };

  const leaderInitialFixture = makeFixture();
  const leaderInitialFirst = socket("leader-initial-1");
  const leaderInitialSecond = socket("leader-initial-2");
  const leaderBeforeInitialSubscription = projectionMetrics(leaderInitialFixture, LEADER_THREAD_TABS_PROJECTION);
  const leaderFirstResponse = subscribe(
    leaderInitialFixture,
    leaderInitialFirst,
    LEADER_THREAD_TABS_PROJECTION,
    leaderInitialFixture.leader.id,
  );
  subscribe(leaderInitialFixture, leaderInitialSecond, LEADER_THREAD_TABS_PROJECTION, leaderInitialFixture.leader.id);
  const leaderAfterInitialSubscription = projectionMetrics(leaderInitialFixture, LEADER_THREAD_TABS_PROJECTION);
  const leaderInitialSubscriptionBytes = leaderFirstResponse.reduce((total, message) => total + utf8Bytes(message), 0);

  const leaderNoOp = await leaderScenario({ invalidations: 1 });
  const leaderSingleChange = await leaderScenario({
    invalidations: 1,
    mutate: (fixture) => updateLeaderStatus(fixture, "changed bounded status", 2_300),
  });
  const leaderBurst = await leaderScenario({
    invalidations: PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations,
    mutate: (fixture) => updateLeaderStatus(fixture, "burst bounded status", 2_400),
  });
  const leaderPhaseChange = await leaderPhaseChangeScenario();
  const leaderHistoricalNoOpFixture = makeFixture();
  const leaderHistoricalSingleFixture = makeFixture();
  updateLeaderJourneyToMemory(leaderHistoricalSingleFixture);
  const leaderHistoricalBurstFixture = makeFixture();
  updateLeaderJourneyToMemory(leaderHistoricalBurstFixture);
  const leaderHistoricalControlSequences = {
    noOp: executeHistoricalControlSequence(1, () => [
      subscribedLeaderBoardActivityResidual(leaderHistoricalNoOpFixture),
      historicalLeaderBoardControl(leaderHistoricalNoOpFixture),
    ]),
    singlePhaseChange: executeHistoricalControlSequence(1, () => [
      subscribedLeaderBoardActivityResidual(leaderHistoricalSingleFixture),
      historicalLeaderBoardControl(leaderHistoricalSingleFixture),
    ]),
    burstPhaseChange: executeHistoricalControlSequence(PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations, () => [
      subscribedLeaderBoardActivityResidual(leaderHistoricalBurstFixture),
      historicalLeaderBoardControl(leaderHistoricalBurstFixture),
    ]),
  };
  const leaderMatchedCompatiblePairSequences = {
    noOp: await matchedLeaderBoardSequence({ producerFrames: 1 }),
    singlePhaseChange: await matchedLeaderBoardSequence({ producerFrames: 1, phaseChange: true }),
    burstPhaseChange: await matchedLeaderBoardSequence({
      producerFrames: PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations,
      phaseChange: true,
    }),
  };

  const leaderReconnectFixture = makeFixture();
  const leaderPriorSocket = socket("leader-prior");
  subscribe(leaderReconnectFixture, leaderPriorSocket, LEADER_THREAD_TABS_PROJECTION, leaderReconnectFixture.leader.id);
  leaderReconnectFixture.bridge.getSyncedProjectionController().removeSubscriber(leaderPriorSocket as never);
  const leaderReconnect = socket("leader-reconnect");
  const leaderBeforeReconnect = projectionMetrics(leaderReconnectFixture, LEADER_THREAD_TABS_PROJECTION);
  const leaderReconnectResponse = subscribe(
    leaderReconnectFixture,
    leaderReconnect,
    LEADER_THREAD_TABS_PROJECTION,
    leaderReconnectFixture.leader.id,
  );
  const leaderAfterReconnect = projectionMetrics(leaderReconnectFixture, LEADER_THREAD_TABS_PROJECTION);

  const leaderNoSubscriberFixture = makeFixture();
  const leaderBeforeTargetedNoSubscriber = projectionMetrics(leaderNoSubscriberFixture, LEADER_THREAD_TABS_PROJECTION);
  const targetedQuestInvalidations = leaderNoSubscriberFixture.bridge.invalidateLeaderThreadTabsForQuestIds(["q-1903"]);
  await leaderNoSubscriberFixture.bridge.getSyncedProjectionController().flushForTest();
  const leaderAfterTargetedNoSubscriber = projectionMetrics(leaderNoSubscriberFixture, LEADER_THREAD_TABS_PROJECTION);
  const leaderBeforeGenericNoSubscriber = projectionMetrics(leaderNoSubscriberFixture, LEADER_THREAD_TABS_PROJECTION);
  leaderNoSubscriberFixture.bridge.getSyncedProjectionController().invalidateSession(leaderNoSubscriberFixture.leader);
  await leaderNoSubscriberFixture.bridge.getSyncedProjectionController().flushForTest();
  const leaderAfterGenericNoSubscriber = projectionMetrics(leaderNoSubscriberFixture, LEADER_THREAD_TABS_PROJECTION);

  const leaderControlFixture = makeFixture();
  const legacyLeaderStatus = historicalLeaderStatusControl(leaderControlFixture);

  return {
    controlCommits: PROJECTION_PERFORMANCE_CONTROL_COMMITS,
    historicalControlBasis: {
      method: "retained-current-executable-payload-assembly",
      limitation:
        "Executes current retained payload builders matching the historical control shapes; it does not execute the historical commit binaries or their frontend derivation loops.",
    },
    fixture: PROJECTION_PERFORMANCE_FIXTURE,
    sessionAttention: {
      initialProjectionSubscriptionResponseBytesPerBrowser: attentionInitialSubscriptionBytes,
      initialProjectionSubscriptionMetrics: metricDelta(
        attentionBeforeInitialSubscription,
        attentionAfterInitialSubscription,
      ),
      equalInvalidation: attentionEqualInvalidation,
      firstNeedsInput: attentionFirstNeedsInput,
      firstReview: attentionFirstReview,
      sameUrgencyCountChange: attentionSameUrgencyCountChange,
      burstNeedsInput: attentionBurstNeedsInput,
      explicitReadClear: attentionExplicitReadClear,
      permissionChange: attentionPermissionChange,
      reconnect: {
        metrics: metricDelta(attentionBeforeReconnect, attentionAfterReconnect),
        projectionSubscriptionResponseMessages: attentionReconnectResponse.length,
        projectionSubscriptionResponseBytes: attentionReconnectResponse.reduce(
          (total, message) => total + utf8Bytes(message),
          0,
        ),
      },
      noSubscriber: attentionNoSubscriber,
    },
    sessionNavigation: {
      bytes: {
        historicalLegacyStatusActivity: utf8Bytes(navigationLegacyControl),
        retainedParallelActivityResidual:
          navigationMatchedCompatiblePairSequences.singleStatusChange.parallel.bytesPerBrowser,
        requiredProjectionStatusUpdate: navigationSingleChange.requiredWireBytesPerBrowser,
        matchedCompatiblePairStatusChange:
          navigationMatchedCompatiblePairSequences.singleStatusChange.combined.bytesPerBrowser,
      },
      initialProjectionSubscriptionResponseBytesPerBrowser: navigationInitialSubscriptionBytes,
      initialProjectionSubscriptionMetrics: metricDelta(
        navigationBeforeInitialSubscription,
        navigationAfterInitialSubscription,
      ),
      historicalControlSequences: navigationHistoricalControlSequences,
      matchedCompatiblePairSequences: navigationMatchedCompatiblePairSequences,
      noOp: navigationNoOp,
      singleChange: navigationSingleChange,
      burstChange: navigationBurst,
      reconnect: {
        metrics: metricDelta(navigationBeforeReconnect, navigationAfterReconnect),
        projectionSubscriptionResponseMessages: navigationReconnectResponse.length,
        projectionSubscriptionResponseBytes: navigationReconnectResponse.reduce(
          (total, message) => total + utf8Bytes(message),
          0,
        ),
      },
      noSubscriber: metricDelta(navigationBeforeNoSubscriber, navigationAfterNoSubscriber),
    },
    leaderThreadTabs: {
      boardProducerProjectionOwnership: {
        sessionNavigationSubscribed: true,
        sessionAttentionSubscribed: true,
        note: "Both the q-1983-parent control and current compatible client are modeled with established leader navigation and attention subscriptions. Navigation ownership suppresses pendingPermissionCount from the companion global activity frame; attention ownership does not further change this payload.",
      },
      bytes: {
        subscribedParallelBoardActivityResidual: leaderPhaseChange.subscribedParallelBoardActivityResidualBytes,
        parallelBoardDetailLegacyPayload: leaderPhaseChange.parallelBoardDetailBytes,
        requiredProjectionPhaseChange: leaderPhaseChange.scenario.requiredWireBytesPerBrowser,
        matchedCompatiblePairPhaseChange:
          leaderPhaseChange.subscribedParallelBoardActivityResidualBytes +
          leaderPhaseChange.scenario.requiredWireBytesPerBrowser +
          leaderPhaseChange.parallelBoardDetailBytes,
        confirmedRemovableLegacyThreadStatusPayload: utf8Bytes(legacyLeaderStatus),
        requiredProjectionStatusUpdate: leaderSingleChange.requiredWireBytesPerBrowser,
        matchedCompatiblePairStatusChange: leaderSingleChange.requiredWireBytesPerBrowser,
      },
      initialProjectionSubscriptionResponseBytesPerBrowser: leaderInitialSubscriptionBytes,
      initialProjectionSubscriptionMetrics: metricDelta(
        leaderBeforeInitialSubscription,
        leaderAfterInitialSubscription,
      ),
      historicalControlSequences: leaderHistoricalControlSequences,
      matchedCompatiblePairSequences: leaderMatchedCompatiblePairSequences,
      noOp: leaderNoOp,
      singleChange: leaderSingleChange,
      burstChange: leaderBurst,
      phaseChange: leaderPhaseChange.scenario,
      reconnect: {
        metrics: metricDelta(leaderBeforeReconnect, leaderAfterReconnect),
        projectionSubscriptionResponseMessages: leaderReconnectResponse.length,
        projectionSubscriptionResponseBytes: leaderReconnectResponse.reduce(
          (total, message) => total + utf8Bytes(message),
          0,
        ),
      },
      noSubscriber: {
        targetedQuestInvalidations,
        targetedQuestMetrics: metricDelta(leaderBeforeTargetedNoSubscriber, leaderAfterTargetedNoSubscriber),
        genericPersistenceMetrics: metricDelta(leaderBeforeGenericNoSubscriber, leaderAfterGenericNoSubscriber),
      },
    },
  };
}

const NO_OP_METRICS: MetricSample = {
  ...zeroMetrics(),
  invalidations: 1,
  batches: 1,
  dependencySelections: 1,
  dependencyEqualSuppressions: 1,
};

function changedMetrics(options: {
  invalidations: number;
  valueBytes: number;
  browserCount?: number;
  cachedValueBytes?: number;
  updateValueBytes?: number;
}): MetricSample {
  const browserCount = options.browserCount ?? PROJECTION_PERFORMANCE_FIXTURE.browserCount;
  const updateValueBytes = options.updateValueBytes ?? options.valueBytes;
  return {
    ...zeroMetrics(),
    invalidations: options.invalidations,
    batches: 1,
    dependencySelections: 1,
    derivations: 1,
    updates: browserCount > 0 ? 1 : 0,
    valueBytes: options.valueBytes,
    cachedValueBytes: options.cachedValueBytes ?? (browserCount > 0 ? 0 : options.valueBytes),
    updateValueBytes: browserCount > 0 ? updateValueBytes : 0,
    deliveries: browserCount,
    deliveredValueBytes: updateValueBytes * browserCount,
  };
}

function reconnectMetrics(valueBytes: number): MetricSample {
  return {
    ...zeroMetrics(),
    snapshots: 1,
    subscriptionsAccepted: 1,
    snapshotValueBytes: valueBytes,
  };
}

function initialSubscriptionMetrics(valueBytes: number): MetricSample {
  return {
    ...zeroMetrics(),
    dependencySelections: 1,
    derivations: 1,
    snapshots: 2,
    subscriptionsAccepted: 2,
    valueBytes,
    cachedValueBytes: valueBytes,
    snapshotValueBytes: valueBytes * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
  };
}

function expectedHistoricalControlSequence(
  producerFrames: number,
  payloadBytesByTypePerProducerFrame: Record<string, number>,
): ExecutedControlSequenceAccounting {
  const payloadsPerFrame = Object.keys(payloadBytesByTypePerProducerFrame).length;
  const payloadBytesPerProducerFrame = Object.values(payloadBytesByTypePerProducerFrame).reduce(
    (total, bytes) => total + bytes,
    0,
  );
  const bytesPerBrowser = producerFrames * payloadBytesPerProducerFrame;
  const assemblies = producerFrames * payloadsPerFrame;
  return {
    producerFrames,
    sourceAssemblies: assemblies,
    payloadAssemblies: assemblies,
    logicalSends: assemblies,
    deliveries: assemblies * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
    subscriptionRequests: 0,
    subscriptionsAccepted: 0,
    payloadBytesPerProducerFrame,
    payloadBytesByTypePerProducerFrame,
    bytesPerBrowser,
    totalBytes: bytesPerBrowser * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
  };
}

function expectedMatchedPair(options: {
  producerFrames: number;
  parallelBytesByTypePerFrame: Record<string, number>;
  projectionBytesPerBrowser: number;
  runtimeMetrics: MetricSample;
}): MatchedCompatiblePairAccounting {
  const parallel = expectedHistoricalControlSequence(options.producerFrames, options.parallelBytesByTypePerFrame);
  const projectionLogicalSends = options.runtimeMetrics.updates;
  const projectionDeliveries = options.runtimeMetrics.deliveries;
  const projectionTotalBytes = options.projectionBytesPerBrowser * PROJECTION_PERFORMANCE_FIXTURE.browserCount;
  return {
    producerFrames: options.producerFrames,
    parallel,
    projection: {
      sourceAssemblies: options.runtimeMetrics.dependencySelections,
      payloadAssemblies: options.runtimeMetrics.updates,
      logicalSends: projectionLogicalSends,
      deliveries: projectionDeliveries,
      bytesPerBrowser: options.projectionBytesPerBrowser,
      totalBytes: projectionTotalBytes,
      runtimeMetrics: options.runtimeMetrics,
    },
    combined: {
      logicalSends: parallel.logicalSends + projectionLogicalSends,
      deliveries: parallel.deliveries + projectionDeliveries,
      bytesPerBrowser: parallel.bytesPerBrowser + options.projectionBytesPerBrowser,
      totalBytes: parallel.totalBytes + projectionTotalBytes,
      subscriptionRequests: 0,
      subscriptionsAccepted: 0,
    },
  };
}

describe("synchronized projection performance controls", () => {
  /** Separates required owner detail, global summary, and projection traffic from the frozen duplicate path. */
  it("measures attention equal, first urgency, count, burst, clear, reconnect, no-subscriber, and two-browser costs", async () => {
    const result = await collectProjectionPerformanceResults();
    const attention = result.sessionAttention;
    const noForbiddenTraffic = {
      observerInboxDeliveries: 0,
      observerPermissionDeliveries: 0,
      rawAttentionSessionUpdateDeliveries: 0,
      globalSummariesWithLegacyAttentionOrPermissionFields: 0,
    };

    expect(result.controlCommits.sessionAttention).toBe("0e5c6eb2e1f49856d48e57556de260b5984f8d2f");
    expect(attention.initialProjectionSubscriptionMetrics).toEqual(initialSubscriptionMetrics(73));
    expect(attention.initialProjectionSubscriptionResponseBytesPerBrowser).toBe(366);
    expect(attention.reconnect).toEqual({
      metrics: reconnectMetrics(73),
      projectionSubscriptionResponseMessages: 2,
      projectionSubscriptionResponseBytes: 366,
    });

    expect(attention.equalInvalidation).toMatchObject({
      metrics: NO_OP_METRICS,
      exactOwnerInbox: emptyAttentionTraffic(),
      compactGlobalSummary: emptyAttentionTraffic(),
      projection: emptyAttentionTraffic(),
      forbidden: noForbiddenTraffic,
      combinedRequiredBytes: 0,
    });

    const changedScenarios = [
      {
        scenario: attention.firstNeedsInput,
        metrics: changedMetrics({ invalidations: 3, valueBytes: 73, cachedValueBytes: 35 }),
        current: { inbox: [459, 0], global: [325, 325], projection: [232, 232], total: 1_573 },
        control: { inbox: [451, 0], global: [1_254, 1_254], raw: [128, 0], total: 3_087 },
        sends: { inbox: 1, global: 1, controlGlobal: 3, controlRaw: 2 },
      },
      {
        scenario: attention.firstReview,
        metrics: changedMetrics({ invalidations: 3, valueBytes: 68, cachedValueBytes: 30 }),
        current: { inbox: [444, 0], global: [320, 320], projection: [227, 227], total: 1_538 },
        control: { inbox: [436, 0], global: [1_239, 1_239], raw: [128, 0], total: 3_042 },
        sends: { inbox: 1, global: 1, controlGlobal: 3, controlRaw: 2 },
      },
      {
        scenario: attention.sameUrgencyCountChange,
        metrics: changedMetrics({ invalidations: 2, valueBytes: 68, cachedValueBytes: 0 }),
        current: { inbox: [591, 0], global: [320, 320], projection: [227, 227], total: 1_685 },
        control: { inbox: [583, 0], global: [826, 826], raw: [64, 0], total: 2_299 },
        sends: { inbox: 1, global: 1, controlGlobal: 2, controlRaw: 1 },
      },
      {
        scenario: attention.burstNeedsInput,
        metrics: changedMetrics({ invalidations: 51, valueBytes: 74, cachedValueBytes: 36 }),
        current: { inbox: [55_041, 0], global: [8_193, 8_189], projection: [233, 233], total: 71_889 },
        control: { inbox: [54_820, 0], global: [21_414, 21_414], raw: [1_664, 0], total: 99_312 },
        sends: { inbox: 25, global: 25, controlGlobal: 51, controlRaw: 26 },
      },
      {
        scenario: attention.explicitReadClear,
        metrics: changedMetrics({ invalidations: 2, valueBytes: 38, cachedValueBytes: -30 }),
        current: { inbox: [295, 0], global: [316, 316], projection: [197, 197], total: 1_321 },
        control: { inbox: [287, 0], global: [834, 834], raw: [87, 0], total: 2_042 },
        sends: { inbox: 1, global: 1, controlGlobal: 2, controlRaw: 1 },
      },
    ] as const;

    for (const { scenario, metrics, current, control, sends } of changedScenarios) {
      expect(scenario.metrics).toEqual(metrics);
      expect(scenario.exactOwnerInbox).toMatchObject({
        logicalSends: sends.inbox,
        deliveries: sends.inbox,
        bytesByBrowser: current.inbox,
      });
      expect(scenario.compactGlobalSummary).toMatchObject({
        logicalSends: sends.global,
        deliveries: sends.global * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
        bytesByBrowser: current.global,
      });
      expect(scenario.projection).toMatchObject({
        logicalSends: 1,
        deliveries: PROJECTION_PERFORMANCE_FIXTURE.browserCount,
        bytesByBrowser: current.projection,
      });
      expect(scenario.forbidden).toEqual(noForbiddenTraffic);
      expect(scenario.combinedRequiredBytes).toBe(current.total);
      expect(scenario.historicalControl.exactOwnerInbox).toMatchObject({
        logicalSends: sends.inbox,
        bytesByBrowser: control.inbox,
      });
      expect(scenario.historicalControl.fullGlobalSummary).toMatchObject({
        logicalSends: sends.controlGlobal,
        deliveries: sends.controlGlobal * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
        bytesByBrowser: control.global,
      });
      expect(scenario.historicalControl.rawAttentionSessionUpdate).toMatchObject({
        logicalSends: sends.controlRaw,
        deliveries: sends.controlRaw,
        bytesByBrowser: control.raw,
      });
      expect(scenario.historicalControl.combined.totalBytes).toBe(control.total);
      expect(scenario.combinedRequiredBytes).toBeLessThan(scenario.historicalControl.combined.totalBytes);
    }

    expect(attention.permissionChange).toMatchObject({
      metrics: changedMetrics({ invalidations: 2, valueBytes: 73, cachedValueBytes: 35 }),
      exactOwnerInbox: emptyAttentionTraffic(),
      ownerPermissionDetail: {
        logicalSends: 1,
        deliveries: 1,
        bytesByBrowser: [231, 0],
        totalBytes: 231,
      },
      compactGlobalSummary: emptyAttentionTraffic(),
      projection: {
        logicalSends: 1,
        deliveries: 2,
        bytesByBrowser: [232, 232],
        totalBytes: 464,
      },
      forbidden: noForbiddenTraffic,
      combinedRequiredBytes: 695,
    });
    expect(attention.permissionChange.historicalControl).toMatchObject({
      ownerPermissionDetail: { logicalSends: 1, deliveries: 1, bytesByBrowser: [223, 0], totalBytes: 223 },
      fullGlobalSummary: { logicalSends: 1, deliveries: 2, bytesByBrowser: [403, 403], totalBytes: 806 },
      rawAttentionSessionUpdate: emptyAttentionTraffic(),
      combined: { logicalSends: 2, deliveries: 3, bytesByBrowser: [626, 403], totalBytes: 1_029 },
    });
    expect(attention.permissionChange.combinedRequiredBytes).toBeLessThan(
      attention.permissionChange.historicalControl.combined.totalBytes,
    );

    expect(attention.noSubscriber).toMatchObject({
      metrics: { ...zeroMetrics(), invalidations: 3 },
      exactOwnerInbox: { logicalSends: 1, deliveries: 1, bytesByBrowser: [454, 0], totalBytes: 454 },
      compactGlobalSummary: { logicalSends: 1, deliveries: 2, bytesByBrowser: [325, 325], totalBytes: 650 },
      projection: emptyAttentionTraffic(),
      forbidden: noForbiddenTraffic,
      combinedRequiredBytes: 1_104,
    });
    expect(attention.noSubscriber.historicalControl.combined).toEqual({
      logicalSends: 6,
      deliveries: 9,
      bytesByBrowser: [1_828, 1_254],
      totalBytes: 3_082,
    });
  });

  /**
   * Navigation assertions keep operation counts exact and separate projection
   * bytes from the retained parallel activity/notification residual. Two sockets
   * verify one logical publication fans out without duplicate recomputation.
   */
  it("measures navigation no-op, change, burst, reconnect, multi-browser, and cold no-subscriber costs", async () => {
    const result = await collectProjectionPerformanceResults();
    const navigation = result.sessionNavigation;

    expect(navigation.noOp).toEqual({
      metrics: NO_OP_METRICS,
      messagesPerBrowser: 0,
      requiredWireBytesPerBrowser: 0,
      requiredWireBytesTotal: 0,
    });
    expect(navigation.singleChange.metrics).toEqual(
      changedMetrics({ invalidations: 2, valueBytes: 1_497, cachedValueBytes: 5, updateValueBytes: 20 }),
    );
    expect(navigation.singleChange.messagesPerBrowser).toBe(1);
    expect(navigation.singleChange.requiredWireBytesTotal).toBe(
      navigation.singleChange.requiredWireBytesPerBrowser * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
    );
    expect(navigation.burstChange.metrics).toEqual(
      changedMetrics({
        invalidations: PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations * 2,
        valueBytes: 1_497,
        cachedValueBytes: 5,
        updateValueBytes: 20,
      }),
    );
    expect(navigation.burstChange.messagesPerBrowser).toBe(1);
    expect(navigation.burstChange.requiredWireBytesTotal).toBe(
      navigation.burstChange.requiredWireBytesPerBrowser * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
    );
    expect(navigation.reconnect.metrics).toEqual(reconnectMetrics(1_492));
    expect(navigation.reconnect.projectionSubscriptionResponseMessages).toBe(2);

    // Status-only navigation activity is fully projection-owned in the current
    // compatible build, so the matched pair emits only the compact field patch.
    expect(navigation.bytes).toEqual({
      historicalLegacyStatusActivity: 412,
      retainedParallelActivityResidual: 0,
      requiredProjectionStatusUpdate: 180,
      matchedCompatiblePairStatusChange: 180,
    });
    expect(navigation.initialProjectionSubscriptionResponseBytesPerBrowser).toBe(1_787);
    expect(navigation.initialProjectionSubscriptionMetrics).toEqual(initialSubscriptionMetrics(1_492));
    expect(navigation.reconnect.projectionSubscriptionResponseBytes).toBe(1_787);

    // The executable historical controls have no subscription work and emit one
    // full activity payload for every producer frame, including semantic no-ops.
    expect(navigation.historicalControlSequences).toEqual({
      noOp: expectedHistoricalControlSequence(1, { session_activity_update: 412 }),
      singleStatusChange: expectedHistoricalControlSequence(1, { session_activity_update: 412 }),
      burstStatusChange: expectedHistoricalControlSequence(25, { session_activity_update: 412 }),
    });
    expect(navigation.matchedCompatiblePairSequences).toEqual({
      noOp: expectedMatchedPair({
        producerFrames: 1,
        parallelBytesByTypePerFrame: {},
        projectionBytesPerBrowser: 0,
        runtimeMetrics: { ...NO_OP_METRICS, invalidations: 2 },
      }),
      singleStatusChange: expectedMatchedPair({
        producerFrames: 1,
        parallelBytesByTypePerFrame: {},
        projectionBytesPerBrowser: 180,
        runtimeMetrics: changedMetrics({
          invalidations: 2,
          valueBytes: 1_497,
          cachedValueBytes: 5,
          updateValueBytes: 20,
        }),
      }),
      burstStatusChange: expectedMatchedPair({
        producerFrames: 25,
        parallelBytesByTypePerFrame: {},
        projectionBytesPerBrowser: 180,
        runtimeMetrics: changedMetrics({
          invalidations: 50,
          valueBytes: 1_497,
          cachedValueBytes: 5,
          updateValueBytes: 20,
        }),
      }),
    });
    expect(navigation.matchedCompatiblePairSequences.noOp.combined.bytesPerBrowser).toBe(0);
    expect(navigation.matchedCompatiblePairSequences.burstStatusChange.combined).toMatchObject({
      logicalSends: 1,
      deliveries: 2,
      bytesPerBrowser: 180,
      totalBytes: 360,
    });
    expect(navigation.noSubscriber).toEqual({ ...zeroMetrics(), invalidations: 1 });
  });

  /**
   * Leader-tab assertions compare a narrow projection-owned status update and an
   * equivalent Work -> Memory board/Journey change. The latter builds its retained
   * parallel board-detail payload from the exact fixture used by the projection.
   */
  it("measures leader-tab no-op, change, burst, reconnect, multi-browser, and no-subscriber costs", async () => {
    const result = await collectProjectionPerformanceResults();
    const leaderTabs = result.leaderThreadTabs;

    expect(leaderTabs.noOp).toEqual({
      metrics: NO_OP_METRICS,
      messagesPerBrowser: 0,
      requiredWireBytesPerBrowser: 0,
      requiredWireBytesTotal: 0,
    });
    expect(leaderTabs.singleChange.metrics).toEqual(
      changedMetrics({ invalidations: 1, valueBytes: 7_304, cachedValueBytes: -7, updateValueBytes: 70 }),
    );
    expect(leaderTabs.singleChange.messagesPerBrowser).toBe(1);
    expect(leaderTabs.singleChange.requiredWireBytesTotal).toBe(
      leaderTabs.singleChange.requiredWireBytesPerBrowser * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
    );
    expect(leaderTabs.burstChange.metrics).toEqual(
      changedMetrics({
        invalidations: PROJECTION_PERFORMANCE_FIXTURE.burstInvalidations,
        valueBytes: 7_302,
        cachedValueBytes: -9,
        updateValueBytes: 68,
      }),
    );
    expect(leaderTabs.burstChange.messagesPerBrowser).toBe(1);
    expect(leaderTabs.burstChange.requiredWireBytesTotal).toBe(
      leaderTabs.burstChange.requiredWireBytesPerBrowser * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
    );
    expect(leaderTabs.phaseChange.metrics).toEqual(
      changedMetrics({ invalidations: 1, valueBytes: 7_395, cachedValueBytes: 84, updateValueBytes: 842 }),
    );
    expect(leaderTabs.phaseChange.messagesPerBrowser).toBe(1);
    expect(leaderTabs.phaseChange.requiredWireBytesTotal).toBe(
      leaderTabs.phaseChange.requiredWireBytesPerBrowser * PROJECTION_PERFORMANCE_FIXTURE.browserCount,
    );
    expect(leaderTabs.reconnect.metrics).toEqual(reconnectMetrics(7_311));
    expect(leaderTabs.reconnect.projectionSubscriptionResponseMessages).toBe(2);

    expect(leaderTabs.boardProducerProjectionOwnership).toEqual({
      sessionNavigationSubscribed: true,
      sessionAttentionSubscribed: true,
      note: "Both the q-1983-parent control and current compatible client are modeled with established leader navigation and attention subscriptions. Navigation ownership suppresses pendingPermissionCount from the companion global activity frame; attention ownership does not further change this payload.",
    });
    // Detailed board state remains authoritative, while compatible-build visual
    // fields and the parallel thread-status update are removed.
    expect(leaderTabs.bytes).toEqual({
      subscribedParallelBoardActivityResidual: 0,
      parallelBoardDetailLegacyPayload: 3_286,
      requiredProjectionPhaseChange: 1_000,
      matchedCompatiblePairPhaseChange: 4_286,
      confirmedRemovableLegacyThreadStatusPayload: 236,
      requiredProjectionStatusUpdate: 228,
      matchedCompatiblePairStatusChange: 228,
    });
    expect(leaderTabs.initialProjectionSubscriptionResponseBytesPerBrowser).toBe(7_602);
    expect(leaderTabs.initialProjectionSubscriptionMetrics).toEqual(initialSubscriptionMetrics(7_311));
    expect(leaderTabs.reconnect.projectionSubscriptionResponseBytes).toBe(7_602);

    // Historical controls retain global activity plus board detail. The current
    // compatible pair sends only detailed board authority and one coalesced patch.
    expect(leaderTabs.historicalControlSequences).toEqual({
      noOp: expectedHistoricalControlSequence(1, {
        session_activity_update: 3_233,
        board_updated: 3_701,
      }),
      singlePhaseChange: expectedHistoricalControlSequence(1, {
        session_activity_update: 3_317,
        board_updated: 3_785,
      }),
      burstPhaseChange: expectedHistoricalControlSequence(25, {
        session_activity_update: 3_317,
        board_updated: 3_785,
      }),
    });
    expect(leaderTabs.matchedCompatiblePairSequences).toEqual({
      noOp: expectedMatchedPair({
        producerFrames: 1,
        parallelBytesByTypePerFrame: { board_updated: 3_285 },
        projectionBytesPerBrowser: 0,
        runtimeMetrics: NO_OP_METRICS,
      }),
      singlePhaseChange: expectedMatchedPair({
        producerFrames: 1,
        parallelBytesByTypePerFrame: { board_updated: 3_286 },
        projectionBytesPerBrowser: 1_000,
        runtimeMetrics: changedMetrics({
          invalidations: 1,
          valueBytes: 7_395,
          cachedValueBytes: 84,
          updateValueBytes: 842,
        }),
      }),
      burstPhaseChange: expectedMatchedPair({
        producerFrames: 25,
        parallelBytesByTypePerFrame: { board_updated: 3_286 },
        projectionBytesPerBrowser: 1_000,
        runtimeMetrics: changedMetrics({
          invalidations: 25,
          valueBytes: 7_395,
          cachedValueBytes: 84,
          updateValueBytes: 842,
        }),
      }),
    });
    expect(leaderTabs.matchedCompatiblePairSequences.noOp.combined).toMatchObject({
      logicalSends: 1,
      deliveries: 2,
      bytesPerBrowser: 3_285,
      totalBytes: 6_570,
    });
    expect(leaderTabs.matchedCompatiblePairSequences.burstPhaseChange.combined).toMatchObject({
      logicalSends: 26,
      deliveries: 52,
      bytesPerBrowser: 83_150,
      totalBytes: 166_300,
    });

    // Both targeted cross-leader invalidation and generic persistence avoid
    // projection selection and value construction until a subscriber requests it.
    expect(leaderTabs.noSubscriber.targetedQuestInvalidations).toBe(0);
    expect(leaderTabs.noSubscriber.targetedQuestMetrics).toEqual(zeroMetrics());
    expect(leaderTabs.noSubscriber.genericPersistenceMetrics).toEqual({ ...zeroMetrics(), invalidations: 1 });
  });

  /**
   * The compact JSON is intentionally opt-in so normal full-suite output stays
   * quiet while documentation can reproduce the exact accepted measurements.
   */
  it("exports a compact reproducible result object for documentation", async () => {
    const result = await collectProjectionPerformanceResults();
    expect(result.controlCommits).toEqual(PROJECTION_PERFORMANCE_CONTROL_COMMITS);
    expect(result.historicalControlBasis).toEqual({
      method: "retained-current-executable-payload-assembly",
      limitation:
        "Executes current retained payload builders matching the historical control shapes; it does not execute the historical commit binaries or their frontend derivation loops.",
    });
    expect(result.fixture).toEqual(PROJECTION_PERFORMANCE_FIXTURE);
    if (process.env.TAKODE_PRINT_PROJECTION_PERFORMANCE === "1") {
      console.log(`PROJECTION_PERFORMANCE_RESULTS=${JSON.stringify(result)}`);
    }
  });
});
