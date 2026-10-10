import { ServerShutdown } from "./server-shutdown.js";
import { serverWorkAdmission } from "./server-work-admission.js";
process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";

// Increase libuv threadpool size BEFORE any I/O operations.
// Default of 4 threads is too small for NFS — concurrent async I/O operations
// (session saves, git info, recordings) saturate the pool, stalling the event loop
// and causing WebSocket ping/pong timeouts (10s budget). Must be set before
// the first libuv I/O call — Node/Bun reads this value once at initialization.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = "64";
}

// Enrich process PATH at startup so binary resolution and `which` calls can find
// binaries installed via version managers (nvm, volta, fnm, etc.).
// Critical when running as a launchd/systemd service with a restricted PATH.
import { getEnrichedPath } from "./path-resolver.js";
process.env.PATH = getEnrichedPath();

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createFileLinkBrowserRoutes } from "./routes/file-link-browser.js";
import { compressBrowserJson } from "./browser-response-compression.js";
import { blockOpaqueOriginApplicationRequest } from "./opaque-origin-guard.js";
import { createRoutes } from "./routes.js";
import { CodexSidecarRegistry } from "./codex-sidecar-auth.js";
import {
  COMPANION_AUTH_TOKEN_HEADER,
  COMPANION_CLIENT_IP_HEADER,
  COMPANION_SESSION_ID_HEADER,
  hasValidSessionToken,
} from "./routes/auth.js";
import { BrowserLogin, loginGate } from "./browser-login.js";
import { createBrowserLoginRoutes } from "./routes/browser-login.js";
import { HOST_LINK_PATH } from "../shared/host-protocol.js";
import { CliLauncher } from "./cli-launcher.js";
import { parentClaudeSessionWarning } from "./cli-launcher-env.js";
import { WsBridge } from "./ws-bridge.js";
import { SessionStore } from "./session-store.js";
import { WorktreeTracker } from "./worktree-tracker.js";
import { containerManager } from "./container-manager.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { TerminalManager } from "./terminal-manager.js";
import { generateFirstName, evaluateSessionName } from "./session-namer.js";
import * as sessionNames from "./session-names.js";
import { bootstrapQuestStore, getActiveQuestForSession, getQuest } from "./quest-store.js";
import {
  clearLegacyMachineSettings,
  getLegacyMachineSettings,
  getServerId,
  getServerSlug,
  getSettings,
  getSettingsFilePath,
  getServerName,
  initWithPort,
} from "./settings-manager.js";
import { PushoverNotifier } from "./pushover.js";
import { WebPushChannel } from "./web-push.js";
import { PRPoller } from "./pr-poller.js";
import { RecorderManager } from "./recorder.js";
import { CronScheduler } from "./cron-scheduler.js";
import { matchWebSocketRoute } from "./websocket-routes.js";
import { TimerManager } from "./timer-manager.js";
import { ResourceLeaseManager } from "./resource-lease-manager.js";
import { ResourceLeaseStore } from "./resource-lease-store.js";
import { LandingQueueManager } from "./landing-queue-manager.js";
import { setLandingRunnerApiPort, startLandingRunner } from "./landing-runner-launcher.js";
import { onMachine } from "./remote-host/host-operations.js";
import { LandingQueueStore } from "./landing-queue-store.js";
import { LandingGateStore } from "./landing-gate-store.js";
import { FULL_SUITE_POOL_PREFIX } from "../shared/landing-queue.js";
import { HostRegistry, LOCAL_HOST_ID, processHostOf } from "./remote-host/host-registry.js";
import { LocalNode, localCoordinatorUrl } from "./remote-host/local-node.js";
import { HostLinkManager } from "./remote-host/host-link-manager.js";
import { HostUpdateSessions } from "./remote-host/host-update-sessions.js";
import { hostPortFor, hostPortGate, mainPortHostRefusal } from "./remote-host/host-port.js";
import { configureMachineSettings } from "./remote-host/machine-settings.js";
import { readCheckoutCommit } from "./remote-host/host-update.js";
import { configureRemoteMachines, hostIsOnline } from "./remote-host/session-machine.js";
import { configureMachines } from "./remote-host/machines.js";
import { ThisMachine, thisMachineDetails } from "./machine-identity.js";
import { stampQuestMachines } from "./quest-machine-stamps.js";
import { stampExistingMemoryNotesInOwnSpaces } from "./memory-note-machines.js";
import { configureRemoteAttachmentDirectories } from "./attachment-paths.js";
import { authenticateHostRequest, createHostRoutes } from "./routes/hosts.js";
import { ImageStore } from "./image-store.js";
import { IdleManager } from "./idle-manager.js";
import { SleepInhibitor } from "./sleep-inhibitor.js";
import { HerdEventDispatcher } from "./herd-event-dispatcher.js";
import { createMessageDeliveryProbe, MessageDeliveryTracker } from "./message-delivery-tracker.js";
import { createUnavailableOrchestratorRecoveryWake } from "./unavailable-orchestrator-recovery.js";
import { createLauncherHerdChangeHandler } from "./herd-change-handler.js";
import {
  resumeRestartContinuations,
  sendRestartContinuation,
  takeHostUpdateRequest,
} from "./restart-continuation-store.js";
import { requestStartupRecoveryRelaunch, runStartupRecovery } from "./startup-recovery.js";
import { getStaticAssetCacheControl } from "./static-asset-cache.js";
import { serveFrontendAssets } from "./frontend-static.js";
import { checkFrontendAvailability } from "./frontend-availability.js";
import { getTakodeProcessBuildId, readTakodeBuildManifest, TAKODE_DEVELOPMENT_BUILD_ID } from "./build-identity.js";
import {
  COMPANION_FRONTEND_RUNTIME_ROOT_ENV,
  createProductionFrontendRestartPreparer,
} from "./frontend-restart-preparation.js";
import { cleanupOwnedFrontendRuntimeSnapshot } from "./frontend-runtime-snapshot.js";
import { markCodexIntentionalRelaunch, markSessionRelaunchPending } from "./bridge/codex-recovery-orchestrator.js";
import { deliverModelProvenanceMigration } from "./model-provenance-migration-delivery.js";
import {
  MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME,
  ModelProvenanceMigrationAcknowledgementStore,
} from "./model-provenance-migration-acknowledgement-store.js";
import { projectModelProvenanceMigrationFamilies } from "./model-provenance-migration-runtime.js";
import {
  addTaskEntry as addTaskEntryController,
  mergeKeywords as mergeKeywordsController,
} from "./bridge/session-registry-controller.js";
import * as envManager from "./env-manager.js";
import { ensureQuestmasterIntegration } from "./quest-integration.js";
import { ensureTakodeIntegration } from "./takode-integration.js";
import { ensureBuiltInQuestJourneyPhaseData } from "./quest-journey-phases.js";
import { ensureSkillSymlinks } from "./skill-symlink.js";
import { runPreListenStartupReadiness, STARTUP_SKILL_SYMLINKS } from "./startup-readiness.js";
import { recreateWorktreeIfMissing } from "./migration.js";
import { RelaunchQueue } from "./relaunch-queue.js";
import { CodexWorkerV2RolloutService } from "./codex-worker-v2-rollout-service.js";
import {
  NAMER_TRIGGER_SOURCES,
  shouldAllowUserMessageOverrideOnNameMismatch,
  type NamerMutationRecord,
  type NamerTriggerSource,
} from "./session-namer-arbitration.js";
import { formatAutoNamerSkipReason, getAutoNamerSkipReason } from "./session-namer-guard.js";
import type { SocketData } from "./ws-bridge.js";
import {
  classifyBrowserClientPlatform,
  closeBrowserConnectionDiagnostics,
} from "./bridge/browser-connection-diagnostics.js";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.env.__COMPANION_PACKAGE_ROOT || resolve(__dirname, "..");

import {
  COORDINATOR_MOVED_EXIT_CODE,
  COORDINATOR_SUPERSEDED_EXIT_CODE,
  DEFAULT_PORT_DEV,
  DEFAULT_PORT_PROD,
  RESTART_EXIT_CODE,
} from "./constants.js";
import {
  claimCoordinatorEpoch,
  coordinatorLockPath,
  coordinatorMovedMessage,
  coordinatorMovePath,
  readCoordinatorMove,
} from "./coordinator-lock.js";
import { checkBackendStartup, installDependencies } from "./backend-startup-check.js";
import { createServerCheckout } from "./server-checkout.js";
import { applyServerTimeZone, timeZoneInEffect } from "./server-time-zone.js";
import { createLogger, flushServerLogger, initServerLogger } from "./server-logger.js";
import {
  getState as getTreeGroupState,
  initTreeGroupStoreForServer,
  reconcileSessionTreeGroups,
} from "./tree-group-store.js";
import { initNewSessionDefaultsStoreForServer } from "./new-session-defaults-store.js";
import { normalizeMemorySessionSpaceSlug } from "./memory-session-space.js";
import { planSessionMemorySpaceBackfill } from "./session-memory-space.js";
import { refreshCodexModelCatalogOnStartup } from "./codex-model-catalog.js";

const defaultPort = process.env.NODE_ENV === "production" ? DEFAULT_PORT_PROD : DEFAULT_PORT_DEV;
const port = Number(process.env.PORT) || defaultPort;
const hostPort = hostPortFor(port);
const frontendRequired = process.env.NODE_ENV === "production";
const frontendRoot = resolve(packageRoot, process.env.COMPANION_FRONTEND_ROOT?.trim() || "dist");
const checkCurrentFrontendAvailability = () =>
  checkFrontendAvailability({
    required: frontendRequired,
    frontendRoot,
  });
const productionFrontendRestartController = (() => {
  if (!frontendRequired || !process.env.COMPANION_SUPERVISED) return undefined;
  const runtimeRoot = process.env[COMPANION_FRONTEND_RUNTIME_ROOT_ENV]?.trim();
  if (!runtimeRoot) return undefined;
  return createProductionFrontendRestartPreparer({
    webRoot: packageRoot,
    runtimeRoot,
    environment: process.env,
    validate: async (candidateRoot) => {
      const availability = await checkFrontendAvailability({ required: true, frontendRoot: candidateRoot });
      if (!availability.ready) {
        throw new Error(`Frontend candidate is not ready (${availability.reason})`);
      }
    },
  });
})();
const prepareProductionFrontendRestart = productionFrontendRestartController?.prepare;
const restartSupported =
  Boolean(process.env.COMPANION_SUPERVISED) && (!frontendRequired || Boolean(productionFrontendRestartController));

// Initialize file-based logging before anything else logs
initServerLogger(port);
const serverLog = createLogger("server");

const startupFrontendAvailability = await checkCurrentFrontendAvailability();
if (frontendRequired && !startupFrontendAvailability.ready) {
  serverLog.error("Production frontend is unavailable at startup", {
    reason: startupFrontendAvailability.reason,
  });
} else if (frontendRequired) {
  serverLog.info("Production frontend readiness verified");
}
const servedFrontendBuildId = frontendRequired
  ? await readTakodeBuildManifest(frontendRoot)
      .then((manifest) => manifest.buildId)
      .catch((error: unknown) => {
        serverLog.warn("Production frontend build identity is unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      })
  : TAKODE_DEVELOPMENT_BUILD_ID;
const runtimeBuildIdentity = {
  backendBuildId: getTakodeProcessBuildId(),
  servedFrontendBuildId,
};
if (
  frontendRequired &&
  (runtimeBuildIdentity.backendBuildId === null ||
    runtimeBuildIdentity.servedFrontendBuildId === null ||
    runtimeBuildIdentity.backendBuildId !== runtimeBuildIdentity.servedFrontendBuildId)
) {
  serverLog.warn("Production frontend/backend build identity is not a compatible pair", runtimeBuildIdentity);
}

await initWithPort(port);
// Before anything formats a local time; a supervised Restart Server reapplies a changed setting.
applyServerTimeZone(getSettings().serverTimeZone ?? "");
serverLog.info("Server time zone", { timeZone: timeZoneInEffect() });
// A coordinator handed off to another machine must not start here, before it touches any shared state.
const coordinatorMove = await readCoordinatorMove(coordinatorMovePath(getServerId()));
if (coordinatorMove) {
  console.error(coordinatorMovedMessage(coordinatorMove, "bun scripts/coordinator-handoff.ts reclaim"));
  serverLog.error("Not starting: this coordinator was handed off to another machine", { ...coordinatorMove });
  await flushServerLogger();
  process.exit(COORDINATOR_MOVED_EXIT_CODE);
}
await bootstrapQuestStore({
  log: (message) => serverLog.info(message),
});
const serverId = getServerId();
const serverSlug = getServerSlug();
const codexSidecarRegistry = new CodexSidecarRegistry({ port, serverId });
await codexSidecarRegistry.initialize();
initTreeGroupStoreForServer({ serverId, port });
initNewSessionDefaultsStoreForServer({ serverId });
const sessionStore = new SessionStore(undefined, port);
const modelProvenanceMigrationAcknowledgementStore = new ModelProvenanceMigrationAcknowledgementStore(
  join(sessionStore.directory, MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME),
);
await modelProvenanceMigrationAcknowledgementStore.load();
const wsBridge = new WsBridge();
const launcher = new CliLauncher(port, { serverId, serverSlug });
const worktreeTracker = new WorktreeTracker();
const CONTAINER_STATE_PATH = join(homedir(), ".companion", "containers.json");
const terminalManager = new TerminalManager();
const prPoller = new PRPoller(wsBridge);
const recorder = new RecorderManager();
const imageStore = new ImageStore();
const cronScheduler = new CronScheduler(launcher, wsBridge);
const timerManager = new TimerManager(wsBridge);
const resourceLeaseManager = new ResourceLeaseManager(wsBridge, new ResourceLeaseStore(serverId));
const hostRegistry = HostRegistry.forServer(serverId);
// Claude/Codex binaries are per-machine settings now; older builds kept them as
// global settings, which become this machine's settings once. Values that differ
// from settings this machine already has stay in the settings file, unused.
const legacyMachineSettings = getLegacyMachineSettings();
if (await hostRegistry.adoptLegacyLocalSettings(legacyMachineSettings)) {
  clearLegacyMachineSettings();
} else if (legacyMachineSettings) {
  serverLog.warn("Kept old Claude/Codex settings that differ from this machine's stored settings", {
    settingsFile: getSettingsFilePath(),
    oldSettings: legacyMachineSettings,
    thisMachine: hostRegistry.machineSettings(LOCAL_HOST_ID),
  });
}
configureMachineSettings(hostRegistry);
const browserLogin = await BrowserLogin.forServer(serverId);
const runningCommit = await readCheckoutCommit(packageRoot);
const hostLinks = new HostLinkManager({ build: runningCommit });
const serverCheckout = createServerCheckout({
  dir: packageRoot,
  runningCommit,
  installDependencies: () => installDependencies(packageRoot),
});
const coordinatorStartedAt = Date.now();
// After the user's Restart Server, hosts that opted in are updated to this
// server's commit right away; otherwise only while none of their sessions is in a turn.
hostLinks.immediateUpdates = await takeHostUpdateRequest(sessionStore.directory).catch((error) => {
  console.warn("[host-link] Could not read the Restart Server request for host updates:", error);
  return false;
});
/**
 * Stop the live sessions whose processes run under a node on the matching
 * hosts. Stopped like idle sessions, they relaunch on their next message.
 */
async function stopNodeSessions(onHost: (hostId: string) => boolean): Promise<void> {
  const live = launcher.listSessions().filter((s) => {
    const host = processHostOf(s);
    return host !== undefined && onHost(host) && !s.archived && s.state !== "exited";
  });
  await Promise.all(
    live.map((s) => {
      s.killedByIdleManager = true;
      return wsBridge.killSession(s.sessionId);
    }),
  );
}
hostLinks.machineSettingsFor = (hostId) => hostRegistry.machineSettings(hostId);
/** Landing runners carry their own one-off credentials instead of a session's. */
const isLandingRunnerRequest = (request: Request): boolean =>
  !!landingQueue.verifyRunner(
    request.headers.get(COMPANION_SESSION_ID_HEADER) ?? undefined,
    request.headers.get(COMPANION_AUTH_TOKEN_HEADER) ?? undefined,
  );
// Machine names belong to the machines, so they survive the coordinator role moving elsewhere.
const thisMachine = await ThisMachine.load();
const notifyFromLandingQueue = (sessionId: string, text: string) => {
  wsBridge.injectUserMessage(sessionId, text, { sessionId: "landing-queue", sessionLabel: "Landing Queue" });
};
setLandingRunnerApiPort(port);
const landingQueue = new LandingQueueManager(
  {
    leases: resourceLeaseManager,
    notify: notifyFromLandingQueue,
    launchRunner: async ({ hostId, ...input }) => {
      // On this machine the server watches the runner, so a run it leaves behind is taken back at once.
      if (!hostId)
        await startLandingRunner(input, {
          onExit: (detail) => void landingQueue.runnerExited(input.launchId, detail),
        });
      else await onMachine(hostId, "startLandingRunner", input);
    },
    onEntryResolved: (entry) => wsBridge.landingHandoff?.entryResolved(entry) ?? Promise.resolve(false),
    alertLeaders: (entries, text) => {
      const leaders = new Set(entries.map((entry) => launcher.getSession(entry.sessionId)?.herdedBy).filter(Boolean));
      for (const leader of leaders) notifyFromLandingQueue(leader!, text);
    },
    sessionNum: (sessionId) => launcher.getSessionNum(sessionId),
    machineName: (hostId) => (hostId ? (hostRegistry.nameOf(hostId) ?? "a remote host") : thisMachine.name),
    invalidateSession: (sessionId) => wsBridge.invalidateSessionNavigation(sessionId),
  },
  new LandingQueueStore(serverId),
  new LandingGateStore(serverId),
);
const hostUpdateSessions = new HostUpdateSessions({
  sessions: () => launcher.listSessions(),
  awaitingReattach: (sessionId) => launcher.isAwaitingHostReattach(sessionId),
  bridgeSession: (sessionId) => wsBridge.getSession(sessionId),
  coordinatorStartedAt,
  landingRunOn: (hostId) => landingQueue.isRunActiveOn(hostId),
  testRunHolders: () => resourceLeaseManager.holdersOf(FULL_SUITE_POOL_PREFIX),
  interrupt: (sessionId, operationId) =>
    wsBridge.interruptSession(sessionId, "user", {
      interruptOrigin: "restart_prep",
      restartPrepOperationId: operationId,
    }),
  holdHerdEvents: ({ operationId, sessionIds, leaderIds, timeoutMs }) => {
    const summary = (sessionId: string) => {
      const sessionNum = launcher.getSessionNum(sessionId);
      return {
        sessionId,
        label: launcher.getSession(sessionId)?.name || (sessionNum != null ? `#${sessionNum}` : sessionId.slice(0, 8)),
      };
    };
    herdEventDispatcher.beginRestartPrepOperation({
      operationId,
      mode: "restart",
      targetSessions: sessionIds.map(summary),
      protectedLeaders: leaderIds.map(summary),
      timeoutMs,
    });
  },
  // Before a host's node restarts for an update.
  stopSessions: (hostId) => stopNodeSessions((host) => host === hostId),
  continueSession: (sessionId, operationId, message) => {
    sendRestartContinuation(wsBridge, sessionId, operationId, message);
  },
});
hostLinks.updateBlocker = (hostId, mode) => hostUpdateSessions.blocker(hostId, mode);
hostLinks.prepareHostUpdate = (hostId, mode) => hostUpdateSessions.prepare(hostId, mode);
hostLinks.onHostRestarted = (hostId) => hostUpdateSessions.hostRestarted(hostId);
hostLinks.nameHost = (hostId, reportedName) => hostRegistry.adoptReportedName(hostId, reportedName, [thisMachine.name]);
configureMachines({
  local: () => ({ name: thisMachine.name, ...thisMachineDetails() }),
  hostName: (hostId) => hostRegistry.nameOf(hostId),
  hostDetails: (hostId) => hostLinks.machineDetails(hostId),
  sessionHostId: (sessionId) => {
    const session = launcher.getSession(sessionId);
    return session ? (session.hostId ?? null) : undefined;
  },
});
hostLinks.start();
// This machine's own node, which runs local sessions so they outlive server restarts.
const localNode = new LocalNode({
  serverId,
  coordinatorUrl: localCoordinatorUrl(process.env.COMPANION_HOST || "0.0.0.0", port),
  nodeScript: join(packageRoot, "bin", "takode-node.ts"),
  registry: hostRegistry,
  links: hostLinks,
});
launcher.setRemoteHosts({
  registry: hostRegistry,
  links: hostLinks,
  useLocalNode: () => localNode.ready(),
});
configureRemoteMachines(hostLinks);
configureRemoteAttachmentDirectories((sessionId) => {
  const hostId = launcher.getSession(sessionId)?.hostId;
  if (!hostId) return null;
  // `~` is expanded by the host when its home directory is not known yet.
  return join(hostLinks.homeDir(hostId) ?? "~", ".companion", "images", sessionId);
});

// ── Performance tracer — event loop lag + slow request/message tracking ──
import { PerfTracer } from "./perf-tracer.js";
import { coreActionLatency } from "./core-action-latency.js";
const perfTracer = new PerfTracer();
perfTracer.startLagMonitor();
perfTracer.startSummaryLogging();
wsBridge.perfTracer = perfTracer;
serverLog.info(`UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE || "4 (default)"}`);
void refreshCodexModelCatalogOnStartup()
  .then((result) => {
    if (!result) {
      serverLog.warn("Codex model catalog startup refresh did not produce models; existing fallbacks remain active");
      return;
    }
    serverLog.info(
      `Codex model catalog startup refresh loaded ${result.models.length} model(s) from ${result.source}` +
        (result.version ? ` (${result.version})` : ""),
    );
  })
  .catch((error) => {
    serverLog.warn("Codex model catalog startup refresh failed; existing fallbacks remain active", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

const webPush = new WebPushChannel({
  filePath: join(homedir(), ".companion", "web-push", `${serverId}.json`),
  getSubject: () => webPushSubject(getSettings().pushoverBaseUrl),
});
const webPushAvailable = await webPush.load().then(
  () => true,
  (error) => {
    serverLog.warn("Web Push store could not be loaded; Web Push is disabled until it is repaired", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  },
);

/** Apple rejects localhost VAPID subjects, so only a public https base URL is used. */
function webPushSubject(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "https:" && url.hostname !== "localhost") return url.origin;
  } catch {
    // Fall through to the generic contact address.
  }
  return "mailto:takode-web-push@example.com";
}

const pushoverNotifier = new PushoverNotifier({
  getSettings: () => {
    const s = getSettings();
    return {
      pushoverUserKey: s.pushoverUserKey,
      pushoverApiToken: s.pushoverApiToken,
      pushoverDelaySeconds: s.pushoverDelaySeconds,
      pushoverEnabled: s.pushoverEnabled,
      pushoverEventFilters: s.pushoverEventFilters,
    };
  },
  getBaseUrl: () => getSettings().pushoverBaseUrl || `http://localhost:${port}`,
  getServerName: () => getServerName() || "Companion",
  getSessionName: (id) => sessionNames.getName(id),
  getSessionActivity: (id) => wsBridge.getSession(id)?.lastActivityPreview,
  getLastReadAt: (id) => wsBridge.getSession(id)?.lastReadAt ?? 0,
  webPush: webPushAvailable ? webPush : undefined,
});

function persistSessionTaskHistory(sessionId: string): void {
  const session = wsBridge.getSession(sessionId);
  if (!session) return;
  wsBridge.broadcastToSession(sessionId, { type: "session_task_history", tasks: session.taskHistory } as any);
  wsBridge.persistSessionById(sessionId);
}

function addTaskHistoryEntry(sessionId: string, entry: import("./session-types.js").SessionTaskEntry): void {
  const session = wsBridge.getSession(sessionId);
  if (!session) return;
  addTaskEntryController(session, entry, {
    broadcastTaskHistory: () => persistSessionTaskHistory(sessionId),
    persistSession: () => wsBridge.persistSessionById(sessionId),
  });
}

function mergeSessionKeywords(sessionId: string, keywords: string[]): void {
  const session = wsBridge.getSession(sessionId);
  if (!session) return;
  mergeKeywordsController(session, keywords, {
    persistSession: () => wsBridge.persistSessionById(sessionId),
  });
}

// ── Wire settings getter so relaunch picks up custom binary settings ────────
launcher.setSettingsGetter(getSettings);

// ── Restore persisted sessions from disk ────────────────────────────────────
wsBridge.store = sessionStore;
wsBridge.recorder = recorder;
wsBridge.imageStore = imageStore;
wsBridge.timerManager = timerManager;
wsBridge.resourceLeaseManager = resourceLeaseManager;
wsBridge.landingQueue = landingQueue;
wsBridge.pushoverNotifier = pushoverNotifier;
wsBridge.launcher = launcher;
const bridgeAny = wsBridge as any;
wsBridge.sessionNameGetter = (sessionId) => sessionNames.getName(sessionId) || sessionId.slice(0, 8);
wsBridge.sessionStoredNameGetter = (sessionId) => sessionNames.getName(sessionId);
wsBridge.resolveQuestTitle = async (questId) => (await getQuest(questId))?.title ?? null;
wsBridge.resolveQuestStatus = async (questId) => (await getQuest(questId))?.status ?? null;
launcher.setStore(sessionStore);
launcher.setRecorder(recorder);
launcher.setEnvResolver(async (slug) => {
  const env = await envManager.getEnv(slug);
  return env?.variables ?? null;
});
await runPreListenStartupReadiness(
  {
    ensureQuestmasterIntegration,
    ensureTakodeIntegration,
    ensureBuiltInQuestJourneyPhaseData,
    ensureSkillSymlinks,
  },
  { port, packageRoot, startupSkillSlugs: STARTUP_SKILL_SYMLINKS },
);
await launcher.restoreFromDisk();
await wsBridge.restoreFromDisk();
// Once: quest notes written before machine stamps existed get the machine their session ran on.
void stampQuestMachines({ coordinatorMachine: thisMachine.name }).catch((error) =>
  serverLog.error("Stamping existing quest notes with machine names failed", { error: String(error) }),
);
// Once per memory repo: notes written before machine stamps existed were all written here.
void stampExistingMemoryNotesInOwnSpaces(thisMachine.name)
  .then((results) => {
    for (const result of results.filter((item) => item.outcome !== "done" || item.notes)) {
      serverLog.info("Stamped existing memory notes with this machine's name", { ...result });
    }
  })
  .catch((error) =>
    serverLog.error("Stamping existing memory notes with machine names failed", { error: String(error) }),
  );
projectModelProvenanceMigrationFamilies(launcher, wsBridge, modelProvenanceMigrationAcknowledgementStore);
{
  const defaultMemorySessionSpaceSlug = normalizeMemorySessionSpaceSlug(launcher.getMemorySessionSpaceSlug());
  const restoredSessions = (
    Array.from(bridgeAny.sessions.values()) as Array<{
      id: string;
      state: { treeGroupId?: string; memorySessionSpaceSlug?: string };
    }>
  ).map((session) => {
    const launcherSession = launcher.getSession(session.id);
    const memorySessionSpaceSlug = session.state.memorySessionSpaceSlug ?? launcherSession?.memorySessionSpaceSlug;
    const normalizedMemorySlug = normalizeMemorySessionSpaceSlug(memorySessionSpaceSlug);
    return {
      sessionId: session.id,
      treeGroupId: session.state.treeGroupId ?? launcherSession?.treeGroupId,
      memorySessionSpaceSlug: normalizedMemorySlug === defaultMemorySessionSpaceSlug ? undefined : normalizedMemorySlug,
    };
  });
  const reconciliation = await reconcileSessionTreeGroups(restoredSessions);
  const resolvedTreeGroups = await getTreeGroupState();
  const memoryBackfillUpdates = planSessionMemorySpaceBackfill(
    restoredSessions.map((session) => ({
      ...session,
      treeGroupId: reconciliation.resolvedGroups[session.sessionId] ?? session.treeGroupId,
    })),
    resolvedTreeGroups,
    launcher.getMemorySessionSpaceSlug(),
  );
  for (const update of reconciliation.sessionMetadataUpdates) {
    const session = wsBridge.getSession(update.sessionId);
    if (session) {
      session.state.treeGroupId = update.treeGroupId;
    }
    const persisted = await sessionStore.load(update.sessionId);
    if (!persisted) continue;
    persisted.state.treeGroupId = update.treeGroupId;
    sessionStore.saveSync(persisted);
  }
  for (const update of memoryBackfillUpdates) {
    launcher.setMemorySessionSpaceSlug(update.sessionId, update.memorySessionSpaceSlug);
    const session = wsBridge.getSession(update.sessionId);
    if (session) {
      session.state.treeGroupId = update.treeGroupId;
      session.state.memorySessionSpaceSlug = update.memorySessionSpaceSlug;
    }
    const persisted = await sessionStore.load(update.sessionId);
    if (!persisted) continue;
    persisted.state.treeGroupId = update.treeGroupId;
    persisted.state.memorySessionSpaceSlug = update.memorySessionSpaceSlug;
    sessionStore.saveSync(persisted);
  }
  if (reconciliation.conflicts.length > 0) {
    const autoReconciled = reconciliation.conflicts.filter(
      (conflict) => conflict.action === "auto_reconciled_stale_default",
    );
    const preserved = reconciliation.conflicts.filter((conflict) => conflict.action === "preserved_divergence");
    serverLog.warn(
      `Observed ${reconciliation.conflicts.length} session tree/memory location conflict(s): ` +
        `autoReconciled=${autoReconciled.length}, preserved=${preserved.length}`,
      {
        conflicts: reconciliation.conflicts.slice(0, 20),
        omittedConflictCount: Math.max(0, reconciliation.conflicts.length - 20),
      },
    );
  }
  if (
    reconciliation.changed ||
    reconciliation.sessionMetadataUpdates.length > 0 ||
    memoryBackfillUpdates.length > 0 ||
    reconciliation.conflicts.length > 0
  ) {
    serverLog.info(
      `Reconciled session tree groups for ${restoredSessions.length} session(s): ` +
        `metadataUpdates=${reconciliation.sessionMetadataUpdates.length}, ` +
        `memorySpaceUpdates=${memoryBackfillUpdates.length}, ` +
        `legacyAssignments=${reconciliation.importedLegacyAssignments.length}, ` +
        `legacyGroups=${reconciliation.importedLegacyGroups.length}, ` +
        `conflicts=${reconciliation.conflicts.length}`,
    );
  }
}
containerManager.restoreState(CONTAINER_STATE_PATH);

// Push-based herd event delivery: wire dispatcher after bridge + launcher are ready
const herdBridge = Object.assign(wsBridge, {
  wakeUnavailableOrchestratorForPendingEvents: createUnavailableOrchestratorRecoveryWake({
    getSession: (sessionId) => wsBridge.getSession(sessionId),
    getLauncherSessionInfo: (sessionId) => launcher.getSession(sessionId),
    isSessionPaused: (sessionId) => wsBridge.isSessionPaused(sessionId),
    requestCodexAutoRecovery: (session, reason) => bridgeAny.requestCodexAutoRecovery(session, reason),
    requestCliRelaunch: (sessionId) => wsBridge.onCLIRelaunchNeeded?.(sessionId),
  }),
});
const herdEventDispatcher = new HerdEventDispatcher(herdBridge, launcher, {
  requestCliRelaunch: (sessionId) => wsBridge.onCLIRelaunchNeeded?.(sessionId),
  getSessionNum: (sessionId) => launcher.getSessionNum(sessionId),
  getSessionName: (sessionId) => sessionNames.getName(sessionId),
  getSessions: () => bridgeAny.sessions,
  getLeaderIdleDeps: () => bridgeAny.getSessionRegistryDeps(),
});
wsBridge.herdEventDispatcher = herdEventDispatcher;
const messageDeliveries = new MessageDeliveryTracker({
  probe: createMessageDeliveryProbe({
    getLauncherSession: (sessionId) => launcher.getSession(sessionId),
    getBridgeSession: (sessionId) => wsBridge.getSession(sessionId),
    hostIsOnline,
    hostName: async (hostId) => (await hostRegistry.get(hostId))?.name ?? hostId,
  }),
  notifySender: (record) =>
    herdEventDispatcher.emitTakodeEventForOrchestrator(
      record.senderSessionId,
      record.targetSessionId,
      "message_delivery",
      {
        messageId: record.id,
        status: record.status === "delivered" ? "delivered" : "failed",
        ...(record.reason ? { reason: record.reason } : {}),
        preview: record.preview,
        queuedAt: record.queuedAt,
        ...(record.questId ? { questId: record.questId } : {}),
      },
    ),
});
launcher.onHerdChange = createLauncherHerdChangeHandler({
  dispatcher: herdEventDispatcher,
  wsBridge,
  launcher,
  getSessionName: (sessionId) => sessionNames.getName(sessionId),
});
// Bootstrap for existing orchestrators (server restart recovery)
for (const s of launcher.listSessions()) {
  if (s.isOrchestrator && !s.archived && launcher.getHerdedSessions(s.sessionId).length > 0) {
    herdEventDispatcher.onHerdChanged(s.sessionId);
  }
}

const codexWorkerV2RolloutService = new CodexWorkerV2RolloutService({
  launcher,
  wsBridge,
  getSessionName: (sessionId) => sessionNames.getName(sessionId),
  log: (message, data) => serverLog.info(message, data),
});

// When the CLI reports its internal session_id, store it for --resume on relaunch.
wsBridge.onCLISessionId = (sessionId, cliSessionId, instructionSnapshot) => {
  launcher.setCLISessionId(sessionId, cliSessionId, instructionSnapshot);
};

// When a Codex adapter is created, attach it to the WsBridge
launcher.onCodexAdapterCreated((sessionId, adapter) => {
  wsBridge.attachCodexAdapter(sessionId, adapter);
});

launcher.onClaudeSdkAdapterCreated((sessionId, adapter) => {
  wsBridge.attachClaudeSdkAdapter(sessionId, adapter);
});

launcher.onModelProvenanceMigrationCallback((sessionId, migration) => {
  deliverModelProvenanceMigration(sessionId, migration, wsBridge);
});

// Mark upcoming adapter disconnects as intentional before relaunch kills
// the old process — prevents the disconnect handler from requesting a
// redundant auto-relaunch that races with the in-progress one.
launcher.onBeforeRelaunchCallback((sessionId, backendType) => {
  const bridgeSession = wsBridge.getSession(sessionId);
  if (backendType === "codex") {
    if (bridgeSession) {
      markCodexIntentionalRelaunch(bridgeSession as any, "relaunch", 15_000);
    }
  }
  // Claude SDK sessions use a different intentional-disconnect mechanism
  // (the adapter.disconnect() call in attachClaudeSdkAdapter sets
  // session.codexAdapter = adapter before the old one's callback fires).

  // Mark the relaunch as in flight so the replacement backend's attach is not
  // mistaken for a recovered connection while it initializes.
  if (bridgeSession) {
    markSessionRelaunchPending(bridgeSession as any);
  }
});

// Start watching PRs when git info is resolved for a session
wsBridge.onGitInfoReady = (sessionId, cwd, branch) => {
  prPoller.watch(sessionId, cwd, branch);
};

// A failed relaunch leaves the session stopped with any queued input undelivered:
// tell the session's viewers, the server log and senders waiting on that input.
function failRelaunch(sessionId: string, message: string): void {
  console.error(`[server] Relaunch failed for session ${sessionId}: ${message}`);
  wsBridge.markCodexAutoRecoveryFailed(sessionId);
  wsBridge.broadcastToSession(sessionId, { type: "error", message });
  messageDeliveries.recordLaunchFailure(sessionId, message);
}

const relaunchQueue = new RelaunchQueue(async (sessionId) => {
  if (serverWorkAdmission.isStopping()) return;
  const info = launcher.getSession(sessionId);
  if (!info || info.archived) return;
  // Don't auto-relaunch sessions killed by the idle manager — they were
  // intentionally stopped to enforce maxKeepAlive.
  if (info.killedByIdleManager) return;

  // If cwd doesn't exist on the session's machine, try to recreate its worktree (e.g. after migration)
  try {
    const wtResult = await recreateWorktreeIfMissing(sessionId, info, { launcher, worktreeTracker, wsBridge });
    if (wtResult.error) return failRelaunch(sessionId, wtResult.error);
    if (wtResult.recreated) {
      console.log(`[server] Recreated worktree for session ${sessionId} before relaunch`);
    }
  } catch (e) {
    return failRelaunch(sessionId, `Failed to recreate worktree: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(`[server] Relaunching session ${sessionId}`);
  const result = await launcher.relaunch(sessionId);
  if (!result.ok) failRelaunch(sessionId, result.error ?? "the relaunch failed");
});

// Auto-relaunch CLI when a browser connects to a session with no CLI
wsBridge.onCLIRelaunchNeeded = (sessionId) => {
  if (serverWorkAdmission.isStopping()) return;
  const info = launcher.getSession(sessionId);
  if (!info || info.archived || info.killedByIdleManager) return;
  if (wsBridge.isSessionPaused(sessionId)) {
    console.log(`[server] Auto-relaunch deferred for paused session ${sessionId}`);
    return;
  }
  // Only suppress relaunch for sessions that are mid-startup AND have an
  // attached backend. After server restart, restored sessions show state
  // "starting" but the old process is orphaned (connected to the dead
  // server's WebSocket) -- relaunching is safe and necessary (q-385).
  if (info.state === "starting" && wsBridge.isBackendAttached(sessionId)) return;
  // The session's process survived the restart on its host and is taken over when the host connects.
  if (launcher.isAwaitingHostReattach(sessionId)) return;
  console.log(`[server] Auto-relaunch requested for session ${sessionId}`);
  relaunchQueue.request(sessionId, { trailing: false });
};

// Restart CLI when ask permission mode changes (updates launcher state + relaunches)
wsBridge.onPermissionModeChanged = (sessionId, newMode) => {
  const info = launcher.getSession(sessionId);
  if (!info || info.archived) return;
  // Update the launcher's stored permission mode before relaunching
  info.permissionMode = newMode;
  console.log(`[server] Relaunch requested for session ${sessionId} with permission mode: ${newMode}`);
  relaunchQueue.request(sessionId);
};

// Relaunch backend when runtime setting changes require process restart (Codex).
wsBridge.onSessionRelaunchRequested = (sessionId) => {
  const info = launcher.getSession(sessionId);
  if (!info || info.archived) return;
  console.log(`[server] Relaunch requested for session ${sessionId} after settings update`);
  relaunchQueue.request(sessionId);
};

// Track which sessions have had at least one auto-naming evaluation
const autoNamingEvaluated = new Set<string>();
// Track the history index at which the current name was derived, so subsequent
// evaluations only show the model events that happened *since* the name was set.
const nameSetAtHistoryIndex = new Map<string, number>();
// ─── Namer cancellation ─────────────────────────────────────────────────────
// Each new namer invocation for the same trigger source cancels any in-flight
// one (kills the `claude -p` subprocess) to avoid stale duplicate work.
const inFlightNamer = new Map<string, AbortController>();

/** Record the last naming mutation applied by the auto-namer for race handling. */
const lastAppliedNamerMutation = new Map<string, NamerMutationRecord>();

function getNamerKey(sessionId: string, source: NamerTriggerSource): string {
  return `${sessionId}:${source}`;
}

/** Cancel any in-flight namer for this session/trigger and return a fresh controller. */
function beginNamerCall(sessionId: string, source: NamerTriggerSource): AbortController {
  const key = getNamerKey(sessionId, source);
  inFlightNamer.get(key)?.abort();
  const controller = new AbortController();
  inFlightNamer.set(key, controller);
  return controller;
}

/** Clean up AbortController after a namer call completes (only if still current). */
function endNamerCall(sessionId: string, source: NamerTriggerSource, controller: AbortController): void {
  const key = getNamerKey(sessionId, source);
  if (inFlightNamer.get(key) === controller) inFlightNamer.delete(key);
}

/** Cancel ALL in-flight namer calls for a session (all trigger sources). */
function cancelAllNamersForSession(sessionId: string): void {
  for (const source of NAMER_TRIGGER_SOURCES) {
    const key = getNamerKey(sessionId, source);
    const ctrl = inFlightNamer.get(key);
    if (ctrl) {
      ctrl.abort();
      inFlightNamer.delete(key);
    }
  }
}

function recordNamerMutation(
  sessionId: string,
  source: NamerTriggerSource,
  action: "name" | "revise" | "new",
  nextName: string,
): void {
  lastAppliedNamerMutation.set(sessionId, {
    source,
    action,
    nextName,
    timestamp: Date.now(),
  });
}

/** Find the ID of the last user_message in a history array (for task entry tracking). */
function findLastUserMessageId(history: import("./session-types.js").BrowserIncomingMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.type === "user_message" && msg.id) return msg.id;
  }
  return `unknown-${Date.now()}`;
}

/** Find the index of the last user_message in history.
 *  Used to set nameSetAtHistoryIndex so subsequent evaluations include
 *  the triggering user message (buildConversationBlock needs a user_message
 *  to start a turn — without it, agent activity would be orphaned). */
function findLastUserMessageIndex(history: import("./session-types.js").BrowserIncomingMessage[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].type === "user_message") return i;
  }
  return 0;
}

/** Check if a session name is a random two-word placeholder (e.g. "Deep Reef"). */
function isRandomSessionName(name: string | null | undefined): boolean {
  return !!name && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name);
}

/** Look up the active quest for a session and map to the namer's expected shape. */
async function getClaimedQuestForNamer(sessionId: string): Promise<{ id: string; title: string } | null> {
  const quest = await getActiveQuestForSession(sessionId);
  if (!quest) return null;
  return { id: quest.questId, title: quest.title };
}

/** Check whether a quest owns the session name (suppresses auto-namer).
 *  Checks both the quest store (in_progress quests) AND the session's claimedQuestId
 *  (which persists through review handoff until final done/cancelled). */
async function isQuestOwningSessionName(sessionId: string): Promise<boolean> {
  if (await getActiveQuestForSession(sessionId)) return true;
  const state = wsBridge.getSession(sessionId)?.state;
  return (
    !!state?.claimedQuestId &&
    (state?.claimedQuestStatus === "in_progress" ||
      state?.claimedQuestStatus === "needs_verification" ||
      (state?.claimedQuestStatus === "done" && state.claimedQuestVerificationInboxUnread !== undefined))
  );
}

async function shouldSkipAutoNamer(
  sessionId: string,
  source: NamerTriggerSource,
  stage: "start" | "apply",
): Promise<boolean> {
  const reason = await getAutoNamerSkipReason({
    isAutoNamerEnabled: () => getSettings().autoNamerEnabled,
    isNoAutoNameSession: () => !!launcher.getSession(sessionId)?.noAutoName,
    isUserNamed: () => sessionNames.isUserNamed(sessionId),
    isQuestOwningName: () => isQuestOwningSessionName(sessionId),
  });
  if (!reason) return false;

  const verb = stage === "apply" ? "Discarding" : "Skipping";
  const noun = stage === "apply" ? `${source} namer result` : `${source} namer`;
  console.log(`[session-namer] ${verb} ${noun} for ${sessionId} (${formatAutoNamerSkipReason(reason)})`);
  return true;
}

/** Apply a naming result: set name, broadcast, add task entry. Shared by all triggers. */
async function applyNamingResult(
  sessionId: string,
  previousName: string,
  result: import("./session-namer.js").NamingResult,
  history: import("./session-types.js").BrowserIncomingMessage[],
  source: NamerTriggerSource,
): Promise<void> {
  if (await shouldSkipAutoNamer(sessionId, source, "apply")) return;
  // Merge keywords regardless of naming action
  if (result.keywords?.length) {
    mergeSessionKeywords(sessionId, result.keywords);
  }

  switch (result.action) {
    case "no_change":
      break;
    case "revise": {
      const freshName = sessionNames.getName(sessionId);
      if (freshName !== previousName) {
        const allowUserOverride =
          source === "user_message" &&
          shouldAllowUserMessageOverrideOnNameMismatch(freshName, lastAppliedNamerMutation.get(sessionId));
        if (!allowUserOverride) return; // name changed while we were evaluating
      }
      sessionNames.setName(sessionId, result.title);
      nameSetAtHistoryIndex.set(sessionId, findLastUserMessageIndex(history));

      wsBridge.invalidateSessionNavigation(sessionId);
      addTaskHistoryEntry(sessionId, {
        title: result.title,
        action: "revise",
        timestamp: Date.now(),
        triggerMessageId: findLastUserMessageId(history),
      });
      recordNamerMutation(sessionId, source, "revise", result.title);
      console.log(`[session-namer] Revised session ${sessionId}: "${previousName}" → "${result.title}"`);
      break;
    }
    case "new": {
      const freshName = sessionNames.getName(sessionId);
      if (freshName !== previousName) {
        const allowUserOverride =
          source === "user_message" &&
          shouldAllowUserMessageOverrideOnNameMismatch(freshName, lastAppliedNamerMutation.get(sessionId));
        if (!allowUserOverride) return;
      }
      sessionNames.setName(sessionId, result.title);
      nameSetAtHistoryIndex.set(sessionId, findLastUserMessageIndex(history));

      wsBridge.invalidateSessionNavigation(sessionId);
      addTaskHistoryEntry(sessionId, {
        title: result.title,
        action: "new",
        timestamp: Date.now(),
        triggerMessageId: findLastUserMessageId(history),
      });
      recordNamerMutation(sessionId, source, "new", result.title);
      console.log(`[session-namer] New task in session ${sessionId}: "${previousName}" → "${result.title}"`);
      break;
    }
  }
}

// ─── Shared helper: evaluate and apply naming for a session ─────────────────
// Used by all three callbacks. Handles both named and unnamed sessions.
async function evaluateAndApply(
  sessionId: string,
  history: import("./session-types.js").BrowserIncomingMessage[],
  cwd: string,
  signal: AbortSignal,
  isGenerating: boolean,
  source: NamerTriggerSource,
  triggerLabel: string,
): Promise<void> {
  const currentName = sessionNames.getName(sessionId);
  const isRandomName = isRandomSessionName(currentName);
  const claimedQuest = await getClaimedQuestForNamer(sessionId);
  const startIndex = nameSetAtHistoryIndex.get(sessionId) ?? 0;
  const relevantHistory = isRandomName ? history : history.slice(startIndex);
  const taskHistory = wsBridge.getSession(sessionId)?.taskHistory ?? [];

  console.log(
    `[session-namer] ${triggerLabel} — evaluating session ${sessionId} (current: ${isRandomName ? "(unnamed)" : `"${currentName}"`}, history: ${relevantHistory.length}/${history.length} msgs, generating: ${isGenerating})...`,
  );

  const result = await evaluateSessionName(
    sessionId,
    currentName ?? "",
    relevantHistory,
    cwd,
    {
      signal,
      isGenerating,
      claimedQuest,
      isUnnamed: isRandomName || !currentName,
      source,
      allowNewTask: source === "user_message",
    },
    taskHistory,
  );
  if (signal.aborted) return;
  if (!result) return;
  await applyNamingResult(sessionId, currentName ?? "", result, history, source);
}

// When a quest claims a session, abort all in-flight namer calls so no stale
// result can overwrite the quest-derived title.
wsBridge.onSessionNamedByQuest = (sessionId, title) => {
  cancelAllNamersForSession(sessionId);
  // Persist the quest title in the name store so it survives server restarts
  // and so subsequent namer checks see a non-random name.
  sessionNames.setName(sessionId, title);
  console.log(`[session-namer] Cancelled all in-flight namer calls for ${sessionId} (quest name takeover: "${title}")`);
};

// Continuous session auto-naming via Claude Haiku (triggered on each user message)
wsBridge.onUserMessage = async (sessionId, history, cwd, wasGenerating) => {
  if (await shouldSkipAutoNamer(sessionId, "user_message", "start")) return;
  const currentName = sessionNames.getName(sessionId);
  const isRandomName = isRandomSessionName(currentName);
  const isFirstEvaluation = !autoNamingEvaluated.has(sessionId);
  // wasGenerating reflects whether the agent was already generating BEFORE
  // this user message was sent (the callback fires after setGenerating(true),
  // so reading session.isGenerating here would always be true).
  const isGenerating = wasGenerating;

  // Cancel any in-flight namer for this session
  const controller = beginNamerCall(sessionId, "user_message");
  const { signal } = controller;

  try {
    if (isFirstEvaluation) {
      autoNamingEvaluated.add(sessionId);
    }

    if (isFirstEvaluation && (!currentName || isRandomName)) {
      // First user message with no real name: generate initial name (one attempt only).
      // If this fails (e.g. Haiku can't generate from a brief prompt), we give up.
      // Subsequent triggers (turn completed, agent paused, next user message) will
      // use the evaluate flow with isUnnamed=true to try again with richer context.
      const claimedQuest = await getClaimedQuestForNamer(sessionId);
      console.log(`[session-namer] Generating initial name for session ${sessionId}...`);
      const result = await generateFirstName(sessionId, history, cwd, { signal, isGenerating, claimedQuest });
      if (signal.aborted) return;
      if (!result || result.action !== "name") return;
      if (await shouldSkipAutoNamer(sessionId, "user_message", "apply")) return;
      // Don't overwrite if user renamed while we were generating
      const freshName = sessionNames.getName(sessionId);
      if (freshName && !isRandomSessionName(freshName)) return;
      sessionNames.setName(sessionId, result.title);
      nameSetAtHistoryIndex.set(sessionId, findLastUserMessageIndex(history));

      wsBridge.invalidateSessionNavigation(sessionId);
      addTaskHistoryEntry(sessionId, {
        title: result.title,
        action: "name",
        timestamp: Date.now(),
        triggerMessageId: findLastUserMessageId(history),
      });
      recordNamerMutation(sessionId, "user_message", "name", result.title);
      if (result.keywords?.length) {
        mergeSessionKeywords(sessionId, result.keywords);
      }
      console.log(`[session-namer] Named session ${sessionId}: "${result.title}"`);
    } else if (currentName) {
      // Subsequent user messages: evaluate whether to rename.
      // If name is still random (initial attempt failed), the evaluate prompt
      // tells the model the name is unknown so it generates one from context.
      await evaluateAndApply(sessionId, history, cwd, signal, isGenerating, "user_message", "User message");
    }
  } finally {
    endNamerCall(sessionId, "user_message", controller);
  }
};

// Re-evaluate session name when agent pauses for plan approval (ExitPlanMode).
// The agent has done meaningful research/work to produce the plan, providing
// rich context for naming — and it's a natural breakpoint before execution.
wsBridge.onAgentPaused = async (sessionId, history, cwd) => {
  if (await shouldSkipAutoNamer(sessionId, "agent_paused", "start")) return;
  const currentName = sessionNames.getName(sessionId);
  if (!currentName) return;

  const controller = beginNamerCall(sessionId, "agent_paused");
  const { signal } = controller;

  try {
    await evaluateAndApply(sessionId, history, cwd, signal, true, "agent_paused", "Agent paused");
  } finally {
    endNamerCall(sessionId, "agent_paused", controller);
  }
};

// Re-evaluate session name after agent completes a turn.
// This lets Haiku refine the title based on what the agent actually did,
// and improves the initial name after the first turn.
//
// The turn-completed namer runs independently from user-message naming.
// User-message outcomes are preferred when both produce competing revisions.
wsBridge.onTurnCompleted = async (sessionId, history, cwd) => {
  codexWorkerV2RolloutService.onTurnCompleted(sessionId);
  if (await shouldSkipAutoNamer(sessionId, "turn_completed", "start")) return;
  const currentName = sessionNames.getName(sessionId);
  if (!currentName) return;

  // Cancel only stale in-flight turn-completed namers; do not cancel user-message
  // namers, so user-message updates can win in revise/revise races.
  const controller = beginNamerCall(sessionId, "turn_completed");
  const { signal } = controller;

  try {
    await evaluateAndApply(sessionId, history, cwd, signal, false, "turn_completed", "Turn completed");
  } finally {
    endNamerCall(sessionId, "turn_completed", controller);
  }
};

console.log(`[server] Session persistence: ${sessionStore.directory}`);
const parentSessionWarning = parentClaudeSessionWarning(process.env);
if (parentSessionWarning) console.warn(`[server] ${parentSessionWarning}`);
if (recorder.isGloballyEnabled()) {
  console.log(`[server] Recording enabled (dir: ${recorder.getRecordingsDir()}, max: ${recorder.getMaxLines()} lines)`);
}

// ── Sleep inhibitor — prevent macOS sleep during generation ──────────────────
const sleepInhibitor = new SleepInhibitor({ wsBridge, launcher, getSettings });

const app = new Hono();

app.route("/", createFileLinkBrowserRoutes(wsBridge));
app.use("/api/*", cors());
app.use("/api/*", compressBrowserJson);
// Browser and terminal sockets authenticate only at upgrade, so revoking logins closes them;
// browsers that still have a valid login reconnect at once.
const appSockets = new Set<ServerWebSocket<SocketData>>();
app.route(
  "/api",
  createBrowserLoginRoutes(browserLogin, {
    onLoginsRevoked: () => {
      for (const ws of appSockets) ws.close(4401, "Login changed");
    },
  }),
);
app.route("/api", createHostRoutes(hostRegistry, hostLinks, thisMachine, hostPort));
app.route(
  "/api",
  createRoutes(
    launcher,
    wsBridge,
    sessionStore,
    worktreeTracker,
    terminalManager,
    prPoller,
    recorder,
    cronScheduler,
    timerManager,
    imageStore,
    pushoverNotifier,
    {
      requestRestart,
      prepareRestart: prepareProductionFrontendRestart,
      checkBackendStartup: () => checkBackendStartup(packageRoot),
      serverCheckout,
      updateCheckoutOnRestart: frontendRequired,
      restartSupported,
      buildIdentity: runtimeBuildIdentity,
      codexSidecarRegistry,
      checkFrontendAvailability: checkCurrentFrontendAvailability,
      webPush: webPushAvailable ? webPush : undefined,
      messageDeliveries,
    },
    perfTracer,
    sleepInhibitor,
    resourceLeaseManager,
    modelProvenanceMigrationAcknowledgementStore,
  ),
);

// In production, serve built frontend using absolute path (works when installed as npm package)
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveFrontendAssets(frontendRoot));
  app.get(
    "/*",
    serveStatic({
      path: resolve(frontendRoot, "index.html"),
      onFound: (path, c) => {
        const cacheControl = getStaticAssetCacheControl(path);
        if (cacheControl) c.header("Cache-Control", cacheControl);
      },
    }),
  );
}

/**
 * Requests on either listener. The main port serves browsers (behind the
 * optional login) and this machine's own node; the host port serves only
 * callers with a host or session token, so a tunnel from another machine can
 * end there without opening the coordinator to that machine's other users.
 */
function handleRequest(listener: "main" | "hosts") {
  return async (req: Request, server: Server<SocketData>): Promise<Response | undefined> => {
    const url = new URL(req.url);
    const wsRoute = matchWebSocketRoute(url.pathname);
    // Nodes may still reconnect: work accepted before the shutdown can be waiting for their answer.
    if (serverWorkAdmission.isStopping() && wsRoute?.kind !== "host") {
      return new Response("Server is shutting down", { status: 503 });
    }

    const opaqueOriginBlock = blockOpaqueOriginApplicationRequest(req, {
      websocketRouteMatched: Boolean(wsRoute),
    });
    if (opaqueOriginBlock) return opaqueOriginBlock;

    if (listener === "hosts") {
      const refused = hostPortGate(req, {
        isHostLink: wsRoute?.kind === "host",
        hasSessionToken: (request) => hasValidSessionToken(request, launcher) || isLandingRunnerRequest(request),
      });
      if (refused) return refused;
    }

    const loginRequired = loginGate(req, {
      login: browserLogin,
      hasSessionToken: (request) => hasValidSessionToken(request, launcher) || isLandingRunnerRequest(request),
      selfAuthenticatedPaths: [HOST_LINK_PATH],
    });
    if (loginRequired) return loginRequired;

    if (wsRoute?.kind === "host") {
      // Hosts are served only once this process holds the coordinator epoch (below).
      if (!hostLinks.epoch) return new Response("Coordinator is starting", { status: 503 });
      const host = await authenticateHostRequest(req, hostRegistry);
      if (!host) return new Response("Unknown host token", { status: 401 });
      if (listener === "main") {
        const refusal = mainPortHostRefusal(host.id, { loginEnabled: browserLogin.enabled, mainPort: port, hostPort });
        if (refusal) return new Response(refusal, { status: 403 });
      }
      if (server.upgrade(req, { data: { kind: "host" as const, hostId: host.id } })) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (wsRoute) {
      const data =
        wsRoute.kind === "terminal"
          ? { kind: "terminal" as const, terminalId: wsRoute.terminalId }
          : {
              kind: wsRoute.kind,
              sessionId: wsRoute.sessionId,
              ...(wsRoute.kind === "browser"
                ? { browserClientPlatform: classifyBrowserClientPlatform(req.headers.get("user-agent")) }
                : {}),
            };
      const upgraded = server.upgrade(req, { data });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Hono handles the rest. Tag requests with the resolved client IP so
    // routes can distinguish loopback browser access from network clients.
    const requestIp = typeof server.requestIP === "function" ? server.requestIP(req) : null;
    const headers = new Headers(req.headers);
    headers.delete(COMPANION_CLIENT_IP_HEADER);
    if (requestIp?.address) {
      headers.set(COMPANION_CLIENT_IP_HEADER, requestIp.address);
    }
    const decoratedRequest = new Request(req, { headers });
    return serverWorkAdmission.track(
      Promise.resolve(app.fetch(decoratedRequest, server)),
      `${req.method} ${url.pathname}`,
    );
  };
}

const listenHost = process.env.COMPANION_HOST || "0.0.0.0";
const maxRequestBodySize = 1024 * 1024 * 1024; // 1 GB — needed for migration import
const websocketHandlers: WebSocketHandler<SocketData> = {
  idleTimeout: 0, // Disable Bun's idle timeout; we manage liveness via ws.ping heartbeats
  maxPayloadLength: 64 * 1024 * 1024, // 64MB -- generous limit for large history syncs
  perMessageDeflate: true, // Compress large payloads (history_sync can be multi-MB JSON)
  open(ws: ServerWebSocket<SocketData>) {
    const data = ws.data;
    if (data.kind !== "host") appSockets.add(ws);
    if (data.kind === "host") {
      hostLinks.attach(data.hostId, ws);
    } else if (data.kind === "browser") {
      wsBridge.handleBrowserOpen(ws, data.sessionId);
    } else if (data.kind === "terminal") {
      terminalManager.addBrowserSocket(data.terminalId, ws);
    }
  },
  message(ws: ServerWebSocket<SocketData>, msg: string | Buffer) {
    const data = ws.data;
    if (data.kind === "host") {
      hostLinks.handleMessage(data.hostId, ws, typeof msg === "string" ? msg : msg.toString("utf-8"));
    } else if (data.kind === "browser") {
      wsBridge.handleBrowserMessage(ws, msg);
    } else if (data.kind === "terminal") {
      terminalManager.handleBrowserMessage(data.terminalId, ws, msg);
    }
  },
  close(ws: ServerWebSocket<SocketData>, code: number, reason: string) {
    const data = ws.data;
    appSockets.delete(ws);
    if (data.kind === "host") {
      hostLinks.detach(data.hostId, ws);
    } else if (data.kind === "browser") {
      // Close diagnostics even if the session was removed while its socket was open.
      closeBrowserConnectionDiagnostics(ws);
      wsBridge.handleBrowserClose(ws, code, reason);
    } else if (data.kind === "terminal") {
      terminalManager.removeBrowserSocket(data.terminalId, ws);
    }
  },
};

const server = Bun.serve<SocketData>({
  hostname: listenHost,
  port,
  maxRequestBodySize,
  fetch: handleRequest("main"),
  websocket: websocketHandlers,
});

// A port another program holds must not keep the server from starting; only hosts are affected.
let hostServer: Server<SocketData> | null = null;
try {
  hostServer = Bun.serve<SocketData>({
    hostname: listenHost,
    port: hostPort,
    maxRequestBodySize,
    fetch: handleRequest("hosts"),
    websocket: websocketHandlers,
  });
} catch (error) {
  serverLog.error("Could not listen on the host port; remote hosts cannot connect", {
    port: hostPort,
    error: error instanceof Error ? error.message : String(error),
  });
}

// Claim the coordinator epoch only after binding the port: a second start that
// cannot listen must not replace a running server, while a restart replaces a
// predecessor that lingers without its socket.
const coordinatorLock = await claimCoordinatorEpoch({
  path: coordinatorLockPath(serverId),
  onSuperseded: (holder) => {
    serverLog.error("Another server process took over this server's state; stopping without saving", { holder });
    serverWorkAdmission.stop();
    void flushServerLogger().finally(() => process.exit(COORDINATOR_SUPERSEDED_EXIT_CODE));
  },
});
hostLinks.epoch = coordinatorLock.epoch;
// Only now can the node connect; until then, sessions it runs wait for it.
localNode.start();

// Start server→browser heartbeat to prevent idle timeout disconnections
wsBridge.startHeartbeat();

// Start watchdog to detect sessions stuck in "generating" state
wsBridge.startStuckSessionWatchdog();

// ── Event loop lag monitor ──────────────────────────────────────────────────
// On slow NFS, Bun's event loop can block for seconds during file I/O,
// delaying WebSocket ping/pong and every other request. This monitor detects
// those stalls so we can identify what operations are causing them.
{
  const LAG_WARN_MS = 500; // warn at 500ms
  const LAG_ALERT_MS = 5_000; // alert at 5s (heartbeat budget is 10s)
  const CHECK_INTERVAL_MS = 2_000;
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const lag = now - lastTick - CHECK_INTERVAL_MS;
    lastTick = now;
    if (lag > LAG_ALERT_MS) {
      console.error(
        `[event-loop] ⚠️  CRITICAL LAG: ${lag.toFixed(0)}ms — Bun event loop was blocked! CLI ping/pong timeout is 10s, this stall may cause CLI disconnections.`,
      );
    } else if (lag > LAG_WARN_MS) {
      console.warn(`[event-loop] Lag detected: ${lag.toFixed(0)}ms`);
    }
  }, CHECK_INTERVAL_MS);
}

const listeningFrontendAvailability = await checkCurrentFrontendAvailability();
console.log(`Server running on http://localhost:${server.port}`);
console.log(`  Browser WebSocket: ws://localhost:${server.port}/ws/browser/:sessionId`);
if (hostServer) console.log(`  Host port (hosts and their agents, tokens only): ${hostServer.port}`);
if (frontendRequired) {
  console.log(
    `  Application ready: ${listeningFrontendAvailability.ready ? "yes" : `no (${listeningFrontendAvailability.reason})`}`,
  );
}

if (process.env.NODE_ENV !== "production") {
  console.log("Dev mode: frontend at http://localhost:5174");
}

if (!process.env.COMPANION_SUPERVISED) {
  serverLog.warn("Not started via 'make dev' or 'make serve' — the Restart Server button will not work.");
  serverLog.warn("Use 'make dev' (dev) or 'make serve' (prod) for restart support.");
}

// ── Cron scheduler ──────────────────────────────────────────────────────────
await cronScheduler.startAll();

// ── Session timers ─────────────────────────────────────────────────────────
await timerManager.startAll();

// ── Global resource leases ─────────────────────────────────────────────────
await resourceLeaseManager.startAll();
await landingQueue.start();
// Landed changes whose commits could not be recorded yet (a host offline, a busy checkout) are retried,
// and outcomes missed while the server was down are picked up.
const landingHandoffRetry = setInterval(
  () => void wsBridge.landingHandoff?.retryPending().catch((error) => console.warn("[landing-handoff]", error)),
  2 * 60_000,
);
setTimeout(() => void wsBridge.landingHandoff?.retryPending().catch(() => undefined), 10_000);

const startupInjectedRelaunchSessionIds = new Set<string>();
async function captureStartupInjectedRelaunches<T>(operation: () => Promise<T>): Promise<T> {
  const original = wsBridge.onCLIRelaunchNeeded;
  wsBridge.onCLIRelaunchNeeded = (sessionId) => {
    startupInjectedRelaunchSessionIds.add(sessionId);
    original?.(sessionId);
  };
  try {
    return await operation();
  } finally {
    wsBridge.onCLIRelaunchNeeded = original;
  }
}

const restartContinuationSessionIds: string[] = [];
await captureStartupInjectedRelaunches(async () => {
  const resumed = await resumeRestartContinuations(sessionStore.directory, wsBridge);
  if (resumed.plan) {
    restartContinuationSessionIds.push(...resumed.plan.sessions.map((session) => session.sessionId));
    serverLog.info("Resumed restart-interrupted sessions", {
      operationId: resumed.plan.operationId,
      sessions: resumed.plan.sessions.length,
      sent: resumed.sent,
      queued: resumed.queued,
      dropped: resumed.dropped,
      noSession: resumed.noSession,
    });
  }
});

await captureStartupInjectedRelaunches(async () => {
  const recovery = await runStartupRecovery({
    listLauncherSessions: () => launcher.listSessions(),
    getSession: (sessionId) => wsBridge.getSession(sessionId),
    isBackendConnected: (sessionId) => wsBridge.isBackendConnected(sessionId),
    isBackendAttached: (sessionId) => wsBridge.isBackendAttached(sessionId),
    isSessionPaused: (sessionId) => wsBridge.isSessionPaused(sessionId),
    requestCliRelaunch: (sessionId, request) => {
      requestStartupRecoveryRelaunch(sessionId, request, {
        requestCliRelaunch: (targetSessionId) => wsBridge.onCLIRelaunchNeeded?.(targetSessionId),
      });
    },
    timerManager,
    restartContinuationSessionIds,
    alreadyRequestedRelaunchSessionIds: startupInjectedRelaunchSessionIds,
    log: (message, data) => serverLog.info(message, data),
  });
  if (recovery.recovered.length > 0) {
    serverLog.info("Startup recovery requested backend relaunch for server-owned work", {
      sessions: recovery.recovered.map((session) => ({
        sessionId: session.sessionId,
        reasons: session.reasons,
        requestedRelaunch: session.requestedRelaunch,
        clearedIdleKilled: session.clearedIdleKilled,
        skippedReason: session.skippedReason,
      })),
    });
  }
});

void codexWorkerV2RolloutService.schedule("startup");

// ── Idle session manager — enforce maxKeepAlive ─────────────────────────────
const idleManager = new IdleManager(launcher, wsBridge, getSettings);
idleManager.start();

// ── Sleep inhibitor — start polling ──────────────────────────────────────────
sleepInhibitor.start();

// ── Shutdown helpers ─────────────────────────────────────────────────────────
const shutdown = new ServerShutdown({
  stopWork: () => {
    // A restart leaves this machine's node running for the next server, and nothing may replace it meanwhile.
    localNode.stop();
    timerManager.stopDispatch();
    cronScheduler.destroy();
    idleManager.stop();
    sleepInhibitor.stop();
    pushoverNotifier.destroy();
    resourceLeaseManager.destroy();
    landingQueue.destroy();
    clearInterval(landingHandoffRetry);
    serverWorkAdmission.track(codexWorkerV2RolloutService.destroy(), "Codex worker rollout shutdown");
  },
  cancelFrontendPreparation: () => productionFrontendRestartController?.cancelAndWait() ?? Promise.resolve(),
  // A stop ends the sessions of every connected node, here or on another host;
  // nobody would see their output until the next start. A host that is offline
  // cannot be told, so its sessions wait to be taken over as after a restart.
  // This machine's node goes too.
  stopSessions: async () => {
    await stopNodeSessions((host) => hostLinks.status(host).online);
    await localNode.shutdown();
  },
  stopListener: async () => {
    await Promise.all([hostServer?.stop(true), server.stop(true)]);
  },
  persist: async () => {
    herdEventDispatcher.preservePendingForShutdown();
    launcher.flushState();
    await Promise.all([
      sessionStore.flushAll(),
      timerManager.flush(),
      coreActionLatency.flush(),
      containerManager.flushState(CONTAINER_STATE_PATH),
    ]);
  },
  cleanupFrontend: cleanupOwnedFrontendRuntimeSnapshot,
  flushLogs: flushServerLogger,
  log: (message, details) => serverLog.info(message, details),
  exit: (code) => process.exit(code),
});

function requestRestart() {
  // Finish the response before closing the listener, but stop admission immediately.
  serverWorkAdmission.stop();
  setTimeout(() => {
    void shutdown.request(RESTART_EXIT_CODE);
  }, 500);
}

process.on("SIGTERM", () => {
  void shutdown.request(0);
});
process.on("SIGINT", () => {
  void shutdown.request(0);
});

// ── Reconnection watchdog ────────────────────────────────────────────────────
// After a server restart, restored backend processes cannot reattach to the new
// server. Give them a grace period, then kill + relaunch any that are still in
// "starting" state.
const RECONNECT_GRACE_MS = Number(process.env.COMPANION_RECONNECT_GRACE_MS || "30000");
const starting = launcher.getStartingSessions();
if (starting.length > 0) {
  serverLog.info(`Waiting ${RECONNECT_GRACE_MS / 1000}s for ${starting.length} CLI process(es) to reconnect...`);
  setTimeout(async () => {
    const stale = launcher.getStartingSessions();
    for (const info of stale) {
      if (serverWorkAdmission.isStopping()) return;
      if (info.archived) continue;
      serverLog.warn("CLI did not reconnect, relaunching session", { sessionId: info.sessionId });
      try {
        const result = await launcher.relaunch(info.sessionId);
        if (!result.ok && result.error) {
          serverLog.error("Relaunch failed after reconnect grace period", {
            sessionId: info.sessionId,
            error: result.error,
          });
        }
      } catch (err) {
        serverLog.error("Relaunch threw after reconnect grace period", { sessionId: info.sessionId, error: err });
      }
    }
  }, RECONNECT_GRACE_MS);
}
