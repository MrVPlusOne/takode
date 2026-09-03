// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIEWPORT_HANDOFF_VERSION,
  type ViewportHandoffPosition,
  type ViewportHandoffRecord,
  type ViewportHandoffSessionState,
} from "../../shared/viewport-handoff.js";
import { useStore } from "../store.js";
import { getFeedViewportKey, readLeaderSelectedThreadKey, readLeaderViewportPosition } from "./thread-viewport.js";
import {
  getViewportHandoffBaselineState,
  getViewportHandoffSessionEntryState,
  getViewportHandoffThreadEntryRecord,
  inspectViewportHandoffClientForTest,
  loadViewportHandoffSession,
  loadViewportHandoffThread,
  noteViewportDeliberateActivity,
  noteViewportSelectionActivity,
  publishViewportHandoff,
  resetViewportHandoffClientForTest,
} from "./viewport-handoff-client.js";

function position(anchorMessageId: string, scrollTop = 420): ViewportHandoffPosition {
  return {
    scrollTop,
    scrollHeight: 2_000,
    isAtBottom: false,
    anchorMessageId,
    anchorTurnId: `turn-${anchorMessageId}`,
    anchorOffsetTop: 72,
  };
}

function record(threadKey: string, revision: number, anchorMessageId: string): ViewportHandoffRecord {
  return {
    version: VIEWPORT_HANDOFF_VERSION,
    threadKey,
    revision,
    sourceId: "remote-browser/remote-page",
    departureId: `remote-departure-${revision}`,
    activityAt: 5_000 + revision,
    updatedAt: 5_000 + revision,
    position: position(anchorMessageId),
  };
}

function state(
  revision: number,
  selectedThreadKey = "main",
  records: ViewportHandoffRecord[] = revision > 0 ? [record("main", revision, `message-${revision}`)] : [],
  selection: { revision?: number; activityAt?: number; updatedAt?: number } = {},
): ViewportHandoffSessionState {
  const updatedAt = revision === 0 ? 0 : 5_000 + revision;
  const selectedThreadRevision = selection.revision ?? revision;
  return {
    version: VIEWPORT_HANDOFF_VERSION,
    sessionId: "session-1",
    revision,
    updatedAt,
    selectedThreadKey,
    selectedThreadRevision,
    selectedThreadActivityAt: selection.activityAt ?? (selectedThreadRevision === 0 ? 0 : updatedAt),
    selectedThreadUpdatedAt: selection.updatedAt ?? (selectedThreadRevision === 0 ? 0 : updatedAt),
    handoffs: Object.fromEntries(records.map((item) => [item.threadKey, item])),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("cc-server-id", "server-a");
  resetViewportHandoffClientForTest();
  useStore.setState({
    feedScrollPosition: new Map(),
    sessions: new Map(),
    sdkSessions: [],
  });
});

describe("viewport handoff client", () => {
  it("hydrates server-selected leader state and thread positions before an entry is ready", async () => {
    const mainRecord = record("main", 2, "main-anchor");
    const questRecord = record("q-2035", 3, "quest-anchor");
    const serverState = state(3, "q-2035", [mainRecord, questRecord]);
    useStore.setState({
      sessions: new Map([["session-1", { isOrchestrator: true } as any]]),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ state: serverState, serverNow: 5_000 })));

    await loadViewportHandoffSession("session-1", { entryId: "session-entry" });

    expect(readLeaderSelectedThreadKey("session-1")).toBe("q-2035");
    expect(readLeaderViewportPosition("session-1", "q-2035")?.anchorMessageId).toBe("quest-anchor");
    expect(useStore.getState().feedScrollPosition.get(getFeedViewportKey("session-1", "main"))?.anchorMessageId).toBe(
      "main-anchor",
    );
  });

  it("requires a successful backend read before publishing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "main",
      position: position("local"),
    });

    expect(response).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((inspectViewportHandoffClientForTest("session-1") as any).sessions[0].lastPublishSkip).toBe(
      "backend-read-required",
    );
  });

  it("coalesces entry reads and duplicate departures while sending a conservative server-time activity estimate", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let resolvePut: ((response: Response) => void) | null = null;
    const putResponse = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!init?.method) {
        now = 1_100;
        return Promise.resolve(jsonResponse({ state: state(4), serverNow: 5_000 }));
      }
      return putResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstRead = loadViewportHandoffSession("session-1", { entryId: "entry-1" });
    const duplicateRead = loadViewportHandoffSession("session-1", { entryId: "entry-1" });
    expect(firstRead).toBe(duplicateRead);
    await firstRead;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(noteViewportDeliberateActivity("session-1", "main", 1_200)).toBe(5_100);
    now = 1_300;
    const input = {
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "q-2035",
      position: position("local-anchor", 800),
      keepalive: true,
    } as const;
    const firstPublish = publishViewportHandoff(input);
    const duplicatePublish = publishViewportHandoff(input);
    expect(firstPublish).toBe(duplicatePublish);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const putCall = fetchMock.mock.calls[1];
    const request = JSON.parse(String(putCall?.[1]?.body));
    expect(request).toMatchObject({
      baseRevision: 4,
      lastDeliberateActivityAt: 5_100,
      threadKey: "main",
      selectedThreadKey: "q-2035",
    });
    expect(request.sourceId).toMatch(/^browser:.+\/page:/);
    expect(request.departureId).toMatch(/^page:.+\/departure:/);
    expect(putCall?.[1]?.keepalive).toBe(true);

    now = 1_400;
    resolvePut!(
      jsonResponse({
        status: "accepted",
        state: state(5, "q-2035", [record("main", 5, "local-anchor")]),
        record: record("main", 5, "local-anchor"),
        serverNow: 5_300,
      }),
    );
    await firstPublish;
    expect(getViewportHandoffBaselineState("session-1")?.revision).toBe(5);
  });

  it("updates the write baseline after a stale response without replacing the open entry snapshot", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const oldRecord = record("q-2035", 2, "entry-anchor");
    const remoteRecord = record("q-2035", 3, "remote-newer-anchor");
    const acceptedRecord = record("q-2035", 4, "local-newer-anchor");
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => {
        now = 1_050;
        return Promise.resolve(
          jsonResponse({
            state: state(2, "q-2035", [oldRecord]),
            threadKey: "q-2035",
            record: oldRecord,
            serverNow: 5_000,
          }),
        );
      })
      .mockImplementationOnce(() => {
        now = 1_150;
        return Promise.resolve(
          jsonResponse({
            status: "stale",
            state: state(3, "q-2035", [remoteRecord]),
            record: remoteRecord,
            serverNow: 5_100,
          }),
        );
      })
      .mockImplementationOnce(() => {
        now = 1_250;
        return Promise.resolve(
          jsonResponse({
            status: "accepted",
            state: state(4, "q-2035", [acceptedRecord]),
            record: acceptedRecord,
            serverNow: 5_200,
          }),
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffThread("session-1", "q-2035", { entryId: "thread-entry" });
    expect(getViewportHandoffThreadEntryRecord("session-1", "q-2035")?.position.anchorMessageId).toBe("entry-anchor");

    noteViewportDeliberateActivity("session-1", "q-2035", 1_075);
    const stale = await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "q-2035",
      selectedThreadKey: "q-2035",
      position: position("local-old-attempt", 700),
    });
    expect(stale?.status).toBe("stale");
    expect(getViewportHandoffBaselineState("session-1")?.revision).toBe(3);
    expect(getViewportHandoffThreadEntryRecord("session-1", "q-2035")?.position.anchorMessageId).toBe("entry-anchor");

    noteViewportDeliberateActivity("session-1", "q-2035", 1_200);
    await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "q-2035",
      selectedThreadKey: "q-2035",
      position: position("local-newer-anchor", 900),
    });
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(secondRequest.baseRevision).toBe(3);
    expect(getViewportHandoffThreadEntryRecord("session-1", "q-2035")?.revision).toBe(2);
    expect(getViewportHandoffBaselineState("session-1")?.revision).toBe(4);
  });

  it("pins the first server scope for the page lifetime and rotates only the page identity on reload", () => {
    const first = inspectViewportHandoffClientForTest() as any;

    localStorage.setItem("cc-server-id", "server-b");
    const stillPinned = inspectViewportHandoffClientForTest() as any;
    expect(stillPinned.identity).toEqual(first.identity);

    localStorage.setItem("cc-server-id", "server-a");
    resetViewportHandoffClientForTest({ preserveBrowserIdentity: true });
    const reloaded = inspectViewportHandoffClientForTest() as any;
    expect(reloaded.identity.scope).toBe("server:server-a");
    expect(reloaded.identity.browserId).toBe(first.identity.browserId);
    expect(reloaded.identity.pageId).not.toBe(first.identity.pageId);

    localStorage.setItem("cc-server-id", "server-b");
    resetViewportHandoffClientForTest({ preserveBrowserIdentity: true });
    const otherServerReload = inspectViewportHandoffClientForTest() as any;
    expect(otherServerReload.identity.scope).toBe("server:server-b");
    expect(otherServerReload.identity.browserId).not.toBe(first.identity.browserId);
  });

  it("keeps the write baseline monotonic when concurrent responses settle newest first", async () => {
    const initialMain = record("main", 1, "initial-main");
    const initialQuest = record("q-2035", 1, "initial-quest");
    const acceptedMain = record("main", 2, "accepted-main");
    const acceptedQuest = record("q-2035", 3, "accepted-quest");
    const mainResponse = deferred<Response>();
    const questResponse = deferred<Response>();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return Promise.resolve(
          jsonResponse({ state: state(1, "main", [initialMain, initialQuest]), serverNow: 5_100 }),
        );
      }
      const request = JSON.parse(String(init.body));
      return request.threadKey === "main" ? mainResponse.promise : questResponse.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffSession("session-1", { entryId: "session-entry" });
    const mainPublish = publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "main",
      position: position("accepted-main"),
    });
    const questPublish = publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "q-2035",
      selectedThreadKey: "q-2035",
      position: position("accepted-quest"),
    });

    questResponse.resolve(
      jsonResponse({
        status: "accepted",
        state: state(3, "q-2035", [acceptedMain, acceptedQuest]),
        record: acceptedQuest,
        serverNow: 5_300,
      }),
    );
    await questPublish;
    expect(getViewportHandoffBaselineState("session-1")?.revision).toBe(3);

    mainResponse.resolve(
      jsonResponse({
        status: "accepted",
        state: state(2, "main", [acceptedMain, initialQuest], { revision: 1, updatedAt: 5_001 }),
        record: acceptedMain,
        serverNow: 5_250,
      }),
    );
    await mainPublish;

    expect(getViewportHandoffBaselineState("session-1")?.revision).toBe(3);
    expect(getViewportHandoffBaselineState("session-1")?.handoffs["q-2035"]?.revision).toBe(3);
  });

  it("performs a fresh read when a different entry arrives during an overlapping GET", async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const firstRead = loadViewportHandoffThread("session-1", "main", { entryId: "entry-a" });
    const secondRead = loadViewportHandoffThread("session-1", "main", { entryId: "entry-b" });
    expect(secondRead).not.toBe(firstRead);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const firstRecord = record("main", 1, "first-entry-anchor");
    firstResponse.resolve(
      jsonResponse({
        state: state(1, "main", [firstRecord]),
        threadKey: "main",
        record: firstRecord,
        serverNow: 5_100,
      }),
    );
    await firstRead;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const secondRecord = record("main", 2, "second-entry-anchor");
    secondResponse.resolve(
      jsonResponse({
        state: state(2, "main", [secondRecord]),
        threadKey: "main",
        record: secondRecord,
        serverNow: 5_200,
      }),
    );
    await secondRead;

    expect(getViewportHandoffThreadEntryRecord("session-1", "main")?.position.anchorMessageId).toBe(
      "second-entry-anchor",
    );
  });

  it("waits for an in-flight same-thread PUT before starting an entry GET", async () => {
    const putResponse = deferred<Response>();
    const returnReadResponse = deferred<Response>();
    let getCount = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return putResponse.promise;
      getCount++;
      if (getCount === 1) {
        const initialRecord = record("main", 1, "initial-anchor");
        return Promise.resolve(
          jsonResponse({
            state: state(1, "main", [initialRecord]),
            threadKey: "main",
            record: initialRecord,
            serverNow: 5_100,
          }),
        );
      }
      return returnReadResponse.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffThread("session-1", "main", { entryId: "initial-entry" });
    const publish = publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "main",
      position: position("departing-anchor"),
    });
    const returnRead = loadViewportHandoffThread("session-1", "main", { entryId: "return-entry" });

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const acceptedRecord = record("main", 2, "departing-anchor");
    putResponse.resolve(
      jsonResponse({
        status: "accepted",
        state: state(2, "main", [acceptedRecord]),
        record: acceptedRecord,
        serverNow: 5_200,
      }),
    );
    await publish;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    returnReadResponse.resolve(
      jsonResponse({
        state: state(2, "main", [acceptedRecord]),
        threadKey: "main",
        record: acceptedRecord,
        serverNow: 5_250,
      }),
    );
    await returnRead;
    expect(getViewportHandoffThreadEntryRecord("session-1", "main")?.position.anchorMessageId).toBe("departing-anchor");
  });

  it("bounds entry waiting when an in-flight departure never settles", async () => {
    vi.useFakeTimers();
    try {
      const putResponse = deferred<Response>();
      const departingPosition = position("departing-anchor", 860);
      let getCount = 0;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") return putResponse.promise;
        getCount++;
        const currentRecord = record("main", 1, "initial-anchor");
        return Promise.resolve(
          jsonResponse({
            state: state(1, "main", [currentRecord]),
            threadKey: "main",
            record: currentRecord,
            serverNow: 5_100,
          }),
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await loadViewportHandoffThread("session-1", "main", { entryId: "initial-entry" });
      const publish = publishViewportHandoff({
        sessionId: "session-1",
        threadKey: "main",
        selectedThreadKey: "main",
        position: departingPosition,
        keepalive: true,
      });
      const returnRead = loadViewportHandoffThread("session-1", "main", { entryId: "return-entry" });
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(750);
      await returnRead;

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(useStore.getState().feedScrollPosition.get(getFeedViewportKey("session-1", "main"))).toEqual(
        departingPosition,
      );

      const acceptedRecord = { ...record("main", 2, "departing-anchor"), position: departingPosition };
      putResponse.resolve(
        jsonResponse({
          status: "accepted",
          state: state(2, "main", [acceptedRecord]),
          record: acceptedRecord,
          serverNow: 5_200,
        }),
      );
      await publish;
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes an unchanged main viewport again after main to quest to main changes the baseline", async () => {
    const mainPosition = position("same-main-anchor", 640);
    const initialMain = record("main", 1, "initial-main");
    const firstMain = record("main", 2, "same-main-anchor");
    const questRecord = record("q-2035", 3, "quest-anchor");
    const secondMain = record("main", 4, "same-main-anchor");
    const writeResponses = [
      { state: state(2, "q-2035", [firstMain]), record: firstMain },
      { state: state(3, "main", [firstMain, questRecord]), record: questRecord },
      { state: state(4, "q-2035", [secondMain, questRecord]), record: secondMain },
    ];
    const putRequests: any[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return Promise.resolve(jsonResponse({ state: state(1, "main", [initialMain]), serverNow: 5_100 }));
      }
      putRequests.push(JSON.parse(String(init.body)));
      const response = writeResponses[putRequests.length - 1];
      return Promise.resolve(jsonResponse({ status: "accepted", ...response, serverNow: 5_200 + putRequests.length }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffSession("session-1", { entryId: "session-entry" });
    await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "q-2035",
      position: mainPosition,
    });
    await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "q-2035",
      selectedThreadKey: "main",
      position: position("quest-anchor"),
    });
    await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "q-2035",
      position: mainPosition,
    });

    expect(putRequests).toHaveLength(3);
    expect(putRequests[0]).toMatchObject({ baseRevision: 1, baseSelectedThreadRevision: 1 });
    expect(putRequests[2]).toMatchObject({ baseRevision: 2, baseSelectedThreadRevision: 3 });
    expect(putRequests[2].position).toEqual(putRequests[0].position);
    expect(putRequests[2].departureId).not.toBe(putRequests[0].departureId);
  });

  it("sends independent viewport and selected-thread activity arbitration fields", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const mainRecord = record("main", 6, "main-anchor");
    const questRecord = record("q-2035", 8, "quest-anchor");
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.method) {
        now = 1_100;
        return Promise.resolve(
          jsonResponse({
            state: state(9, "main", [mainRecord, questRecord], { revision: 7, updatedAt: 5_007 }),
            serverNow: 5_000,
          }),
        );
      }
      const acceptedMain = record("main", 10, "local-main");
      return Promise.resolve(
        jsonResponse({
          status: "accepted",
          state: state(10, "q-2035", [acceptedMain, questRecord]),
          record: acceptedMain,
          serverNow: 5_300,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffSession("session-1", { entryId: "session-entry" });
    expect(noteViewportDeliberateActivity("session-1", "main", 1_200)).toBe(5_100);
    expect(noteViewportSelectionActivity("session-1", "q-2035", 1_250)).toBe(5_150);
    now = 1_300;
    await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "q-2035",
      position: position("local-main"),
    });

    const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(request).toMatchObject({
      baseRevision: 6,
      baseSelectedThreadRevision: 7,
      lastDeliberateActivityAt: 5_100,
      lastSelectionActivityAt: 5_150,
      threadKey: "main",
      selectedThreadKey: "q-2035",
    });
  });

  it("preserves a pending same-browser keepalive position when reload GET wins the response race", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const oldRecord = record("main", 1, "server-old-anchor");
    const oldPutResponse = deferred<Response>();
    let getCount = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return oldPutResponse.promise;
      getCount++;
      now = getCount === 1 ? 1_100 : 1_300;
      return Promise.resolve(jsonResponse({ state: state(1, "main", [oldRecord]), serverNow: 5_000 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffSession("session-1", { entryId: "before-reload" });
    const beforeReloadIdentity = (inspectViewportHandoffClientForTest() as any).identity;
    now = 1_200;
    const pendingPosition = position("same-browser-local-anchor", 880);
    const oldPut = publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "q-2035",
      position: pendingPosition,
      keepalive: true,
    });
    const oldRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

    resetViewportHandoffClientForTest({ preserveBrowserIdentity: true, preservePendingDepartures: true });
    useStore.setState({ feedScrollPosition: new Map() });
    await loadViewportHandoffSession("session-1", { entryId: "after-reload" });

    const afterReloadIdentity = (inspectViewportHandoffClientForTest() as any).identity;
    expect(afterReloadIdentity.browserId).toBe(beforeReloadIdentity.browserId);
    expect(afterReloadIdentity.pageId).not.toBe(beforeReloadIdentity.pageId);
    expect(fetchMock.mock.calls[1]?.[1]?.keepalive).toBe(true);
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBeUndefined();
    expect(readLeaderSelectedThreadKey("session-1")).toBe("q-2035");
    expect(readLeaderViewportPosition("session-1", "main")).toEqual(pendingPosition);
    expect(useStore.getState().feedScrollPosition.get(getFeedViewportKey("session-1", "main"))).toEqual(
      pendingPosition,
    );

    const acceptedRecord: ViewportHandoffRecord = {
      ...record("main", 2, "same-browser-local-anchor"),
      sourceId: oldRequest.sourceId,
      departureId: oldRequest.departureId,
      position: pendingPosition,
    };
    oldPutResponse.resolve(
      jsonResponse({
        status: "accepted",
        state: state(2, "q-2035", [acceptedRecord]),
        record: acceptedRecord,
        serverNow: 5_200,
      }),
    );
    await oldPut;
    expect(readLeaderViewportPosition("session-1", "main")).toEqual(pendingPosition);
  });

  it("does not let a pending idle reload receipt override a newer backend handoff", async () => {
    const oldRecord = record("main", 1, "server-old-anchor");
    const remoteRecord = record("main", 2, "remote-newer-anchor");
    const oldPutResponse = deferred<Response>();
    let getCount = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return oldPutResponse.promise;
      getCount++;
      return Promise.resolve(
        jsonResponse({
          state: getCount === 1 ? state(1, "main", [oldRecord]) : state(2, "q-2035", [remoteRecord]),
          serverNow: 5_100 + getCount,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffSession("session-1", { entryId: "before-reload" });
    const oldPut = publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "main",
      position: position("idle-local-anchor", 760),
      keepalive: true,
    });

    resetViewportHandoffClientForTest({ preserveBrowserIdentity: true, preservePendingDepartures: true });
    useStore.setState({ feedScrollPosition: new Map() });
    await loadViewportHandoffSession("session-1", { entryId: "after-reload" });

    expect(readLeaderSelectedThreadKey("session-1")).toBe("q-2035");
    expect(readLeaderViewportPosition("session-1", "main")?.anchorMessageId).toBe("remote-newer-anchor");

    oldPutResponse.resolve(
      jsonResponse({
        status: "stale",
        state: state(2, "q-2035", [remoteRecord]),
        record: remoteRecord,
        serverNow: 5_200,
      }),
    );
    await oldPut;
  });

  it("carries pending reload activity into the next departure write", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const oldPutResponse = deferred<Response>();
    let putCount = 0;
    let acceptedState: ViewportHandoffSessionState | null = null;
    let acceptedRecord: ViewportHandoffRecord | null = null;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== "PUT") {
        return Promise.resolve(jsonResponse({ state: state(1), serverNow: 5_100 }));
      }
      putCount += 1;
      if (putCount === 1) return oldPutResponse.promise;
      const request = JSON.parse(String(init.body));
      acceptedRecord = {
        ...record("main", 2, "pending-local-anchor"),
        sourceId: request.sourceId,
        departureId: request.departureId,
        activityAt: request.lastDeliberateActivityAt,
        position: request.position,
      };
      acceptedState = state(2, "q-2035", [acceptedRecord], {
        revision: 2,
        activityAt: request.lastSelectionActivityAt,
      });
      return Promise.resolve(
        jsonResponse({
          status: "accepted",
          state: acceptedState,
          record: acceptedRecord,
          serverNow: 5_300,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffSession("session-1", { entryId: "before-reload" });
    noteViewportDeliberateActivity("session-1", "main", 1_100);
    noteViewportSelectionActivity("session-1", "q-2035", 1_150);
    const oldPut = publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "q-2035",
      position: position("pending-local-anchor"),
      keepalive: true,
    });
    const oldRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

    resetViewportHandoffClientForTest({ preserveBrowserIdentity: true, preservePendingDepartures: true });
    useStore.setState({ feedScrollPosition: new Map() });
    await loadViewportHandoffSession("session-1", { entryId: "after-reload" });
    await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "q-2035",
      position: position("pending-local-anchor"),
    });

    const nextRequest = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(nextRequest).toMatchObject({
      lastDeliberateActivityAt: oldRequest.lastDeliberateActivityAt,
      lastSelectionActivityAt: oldRequest.lastSelectionActivityAt,
    });

    oldPutResponse.resolve(
      jsonResponse({
        status: "duplicate",
        state: acceptedState,
        record: acceptedRecord,
        serverNow: 5_300,
      }),
    );
    await oldPut;
  });

  it("orders pending reload position against accepted activity rather than commit time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);

    const restorePendingPosition = async (activityDelta: number, commitDelta: number) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("cc-server-id", "server-a");
      resetViewportHandoffClientForTest();
      useStore.setState({ feedScrollPosition: new Map() });

      const firstRecord = record("main", 1, "server-old-anchor");
      const putResponse = deferred<Response>();
      let remoteRecord: ViewportHandoffRecord | null = null;
      let remoteState: ViewportHandoffSessionState | null = null;
      let getCount = 0;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") return putResponse.promise;
        getCount += 1;
        return Promise.resolve(
          jsonResponse({
            state: getCount === 1 ? state(1, "main", [firstRecord]) : remoteState,
            serverNow: getCount === 1 ? 5_100 : 6_000,
          }),
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await loadViewportHandoffSession("session-1", { entryId: "before-reload" });
      noteViewportDeliberateActivity("session-1", "main", 1_100);
      const pendingPut = publishViewportHandoff({
        sessionId: "session-1",
        threadKey: "main",
        selectedThreadKey: "main",
        position: position("pending-local-anchor"),
        keepalive: true,
      });
      const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
      remoteRecord = {
        ...record("main", 2, "remote-anchor"),
        activityAt: request.lastDeliberateActivityAt + activityDelta,
        updatedAt: request.lastDeliberateActivityAt + commitDelta,
      };
      remoteState = state(1_000, "main", [remoteRecord]);

      resetViewportHandoffClientForTest({ preserveBrowserIdentity: true, preservePendingDepartures: true });
      useStore.setState({ feedScrollPosition: new Map() });
      await loadViewportHandoffSession("session-1", { entryId: "after-reload" });
      const anchorMessageId = readLeaderViewportPosition("session-1", "main")?.anchorMessageId;

      putResponse.resolve(
        jsonResponse({
          status: "stale",
          state: remoteState,
          record: remoteRecord,
          serverNow: 6_000,
        }),
      );
      await pendingPut;
      return anchorMessageId;
    };

    expect(await restorePendingPosition(-1, 100)).toBe("pending-local-anchor");
    expect(await restorePendingPosition(1, -100)).toBe("remote-anchor");
  });

  it("orders pending reload selection against accepted activity rather than commit time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);

    const restorePendingSelection = async (activityDelta: number, commitDelta: number) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("cc-server-id", "server-a");
      resetViewportHandoffClientForTest();
      useStore.setState({ feedScrollPosition: new Map() });

      const firstRecord = record("main", 1, "server-old-anchor");
      const remoteRecord = record("main", 2, "remote-newer-anchor");
      const putResponse = deferred<Response>();
      let remoteState: ViewportHandoffSessionState | null = null;
      let getCount = 0;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") return putResponse.promise;
        getCount += 1;
        return Promise.resolve(
          jsonResponse({
            state: getCount === 1 ? state(1, "main", [firstRecord]) : remoteState,
            serverNow: getCount === 1 ? 5_100 : 6_000,
          }),
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await loadViewportHandoffSession("session-1", { entryId: "before-reload" });
      noteViewportSelectionActivity("session-1", "q-2035", 1_100);
      const pendingPut = publishViewportHandoff({
        sessionId: "session-1",
        threadKey: "main",
        selectedThreadKey: "q-2035",
        position: position("pending-local-anchor"),
        keepalive: true,
      });
      const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
      remoteState = state(1_000, "all", [remoteRecord], {
        revision: 1_000,
        activityAt: request.lastSelectionActivityAt + activityDelta,
        updatedAt: request.lastSelectionActivityAt + commitDelta,
      });

      resetViewportHandoffClientForTest({ preserveBrowserIdentity: true, preservePendingDepartures: true });
      useStore.setState({ feedScrollPosition: new Map() });
      await loadViewportHandoffSession("session-1", { entryId: "after-reload" });
      const selectedThreadKey = readLeaderSelectedThreadKey("session-1");

      putResponse.resolve(
        jsonResponse({
          status: "stale",
          state: remoteState,
          record: remoteRecord,
          serverNow: 6_000,
        }),
      );
      await pendingPut;
      return selectedThreadKey;
    };

    expect(await restorePendingSelection(-1, 100)).toBe("q-2035");
    expect(await restorePendingSelection(1, -100)).toBe("all");
  });

  it("keeps full-session entry state frozen when later writes advance the baseline", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ state: state(1), serverNow: 5_000 }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "duplicate",
          state: state(2),
          record: record("main", 2, "message-2"),
          serverNow: 5_100,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await loadViewportHandoffSession("session-1", { entryId: "session-entry" });
    await publishViewportHandoff({
      sessionId: "session-1",
      threadKey: "main",
      selectedThreadKey: "main",
      position: position("message-2"),
    });

    expect(getViewportHandoffSessionEntryState("session-1")?.revision).toBe(1);
    expect(getViewportHandoffBaselineState("session-1")?.revision).toBe(2);
  });
});
