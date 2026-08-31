import { describe, expect, it } from "vitest";
import { SESSION_NAVIGATION_PROJECTION } from "../shared/session-navigation-projection.js";
import { setSessionClaimedQuest } from "./bridge/session-registry-controller.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { WsBridge, type SocketData } from "./ws-bridge.js";

type CapturingSocket = {
  data: SocketData;
  readyState: number;
  sent: string[];
  send: (raw: unknown) => number;
};

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

function wireBytes(target: CapturingSocket): number {
  return target.sent.reduce((total, raw) => total + Buffer.byteLength(raw), 0);
}

function retiredFrameBytes(message: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(message));
}

function report(label: string, value: Record<string, unknown>): void {
  if (process.env.TAKODE_PROJECTION_NAME_PERF_REPORT === "1") {
    console.info(`[projection-name-performance] ${label} ${JSON.stringify(value)}`);
  }
}

function projectionMetrics(bridge: WsBridge) {
  const metrics = bridge.getSyncedProjectionController().getMetrics().projections[SESSION_NAVIGATION_PROJECTION];
  if (!metrics) throw new Error("Missing session-navigation metrics");
  return metrics;
}

function metricDelta(before: ReturnType<typeof projectionMetrics>, after: ReturnType<typeof projectionMetrics>) {
  return {
    invalidations: after.invalidations - before.invalidations,
    batches: after.batches - before.batches,
    dependencySelections: after.dependencySelections - before.dependencySelections,
    derivations: after.derivations - before.derivations,
    updates: after.updates - before.updates,
    deliveries: after.deliveries - before.deliveries,
  };
}

function setup() {
  let workerName = "Worker before rename";
  const bridge = new WsBridge();
  bridge.launcher = {
    getSession: () => ({
      sessionId: "worker",
      state: "connected",
      cwd: "/repo",
      repoRoot: "/repo",
      createdAt: 1,
      backendType: "codex",
      isOrchestrator: false,
    }),
  } as never;
  bridge.sessionNameGetter = () => workerName;
  bridge.sessionStoredNameGetter = bridge.sessionNameGetter;
  bridge.timerManager = { listTimers: () => [] } as never;

  const worker = bridge.getOrCreateSession("worker", "codex");
  worker.state.model = "gpt-5.6";
  worker.state.cwd = "/repo";
  worker.state.repo_root = "/repo";
  worker.state.permissionMode = "default";
  const browsers = [socket("worker"), socket("worker")];
  for (const browser of browsers) {
    worker.browserSockets.add(browser as never);
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(browser as never, [{ projection: SESSION_NAVIGATION_PROJECTION, key: worker.id }]);
    browser.sent.length = 0;
  }

  return {
    bridge,
    worker,
    browsers,
    setWorkerName: (name: string) => {
      workerName = name;
    },
  };
}

describe("session navigation name and claim performance", () => {
  it("publishes a rename once and removes the retired name frame cost", async () => {
    const fixture = setup();
    const before = projectionMetrics(fixture.bridge);
    const nextLegacySeq = fixture.worker.nextEventSeq;

    fixture.setWorkerName("Renamed projection session");
    fixture.bridge.invalidateSessionNavigation(fixture.worker.id);
    await fixture.bridge.getSyncedProjectionController().flushForTest();

    expect(metricDelta(before, projectionMetrics(fixture.bridge))).toEqual({
      invalidations: 1,
      batches: 1,
      dependencySelections: 1,
      derivations: 1,
      updates: 1,
      deliveries: 2,
    });
    for (const browser of fixture.browsers) {
      const messages = browser.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
      expect(messages).toEqual([
        expect.objectContaining({
          type: "synced_projection_update",
          projection: SESSION_NAVIGATION_PROJECTION,
          patch: { name: "Renamed projection session" },
        }),
      ]);
      const currentBytes = wireBytes(browser);
      const priorDualPathBytes =
        currentBytes +
        retiredFrameBytes({
          type: "session_name_update",
          name: "Renamed projection session",
          seq: nextLegacySeq,
        });
      report("rename", { currentBytes, priorDualPathBytes, nextLegacySeq });
      expect({ currentBytes, priorDualPathBytes }).toEqual({ currentBytes: 195, priorDualPathBytes: 269 });
    }
  });

  it("keeps public name invalidation demand-gated without subscribers", async () => {
    const fixture = setup();
    for (const browser of fixture.browsers) {
      fixture.bridge.getSyncedProjectionController().removeSubscriber(browser as never);
      browser.sent.length = 0;
    }
    const before = projectionMetrics(fixture.bridge);

    fixture.setWorkerName("Unobserved rename");
    fixture.bridge.invalidateSessionNavigation(fixture.worker.id);
    await fixture.bridge.getSyncedProjectionController().flushForTest();

    expect(metricDelta(before, projectionMetrics(fixture.bridge))).toEqual({
      invalidations: 1,
      batches: 0,
      dependencySelections: 0,
      derivations: 0,
      updates: 0,
      deliveries: 0,
    });
    expect(fixture.browsers.every((browser) => browser.sent.length === 0)).toBe(true);
  });

  it("keeps claim detail plus one projected row update without a duplicate name frame", async () => {
    const fixture = setup();
    const before = projectionMetrics(fixture.bridge);
    const claimDetailSeq = fixture.worker.nextEventSeq;

    // Exercise the real ordering: durable name callback first, retained claim detail second,
    // then one coalesced projection update carrying the compact visual fields.
    setSessionClaimedQuest(
      fixture.worker,
      { id: "q-4242", title: "Projected quest claim", status: "in_progress", leaderSessionId: "leader" },
      {
        broadcastToBrowsers: (_session, message: BrowserIncomingMessage) =>
          fixture.bridge.broadcastToSession(fixture.worker.id, message),
        persistSession: () => {},
        getLauncherSessionInfo: () => ({ isOrchestrator: false }) as never,
        onSessionNamedByQuest: (_sessionId, title) => fixture.setWorkerName(title),
      },
    );
    await fixture.bridge.getSyncedProjectionController().flushForTest();

    expect(metricDelta(before, projectionMetrics(fixture.bridge))).toEqual({
      invalidations: 1,
      batches: 1,
      dependencySelections: 1,
      derivations: 1,
      updates: 1,
      deliveries: 2,
    });
    for (const browser of fixture.browsers) {
      const messages = browser.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
      expect(messages.map((message) => message.type)).toEqual(["session_quest_claimed", "synced_projection_update"]);
      expect(messages[1]).toMatchObject({
        projection: SESSION_NAVIGATION_PROJECTION,
        patch: {
          name: "Projected quest claim",
          claimedQuestId: "q-4242",
          claimedQuestTitle: "Projected quest claim",
          claimedQuestStatus: "in_progress",
          claimedQuestLeaderSessionId: "leader",
        },
      });
      const currentBytes = wireBytes(browser);
      const priorDualPathBytes =
        currentBytes +
        retiredFrameBytes({
          type: "session_name_update",
          name: "Projected quest claim",
          source: "quest",
          seq: claimDetailSeq + 1,
        });
      report("claim", { currentBytes, priorDualPathBytes, claimDetailSeq });
      expect({ currentBytes, priorDualPathBytes }).toEqual({ currentBytes: 480, priorDualPathBytes: 566 });
    }
  });
});
