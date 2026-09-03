import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewportHandoffWriteRequest } from "../../shared/viewport-handoff.js";
import { ViewportHandoffStore } from "../viewport-handoff-store.js";
import { registerSessionViewportHandoffRoute } from "./session-viewport-handoff-route.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoute(options?: { leader?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), "takode-viewport-handoff-route-"));
  roots.push(root);
  const store = new ViewportHandoffStore(root);
  const broadcastToSession = vi.fn();
  const api = new Hono();
  registerSessionViewportHandoffRoute(api, {
    launcher: {
      getSession: vi.fn((sessionId: string) =>
        sessionId === "session-1"
          ? {
              sessionId,
              isOrchestrator: options?.leader === true,
              cwd: "/repo",
              createdAt: 1,
            }
          : null,
      ),
    } as any,
    resolveId: (raw: string) => (raw === "1" || raw === "session-1" ? "session-1" : null),
    viewportHandoffStore: store,
    broadcastToSession,
  } as any);
  return { api, store, broadcastToSession };
}

function request(overrides: Partial<ViewportHandoffWriteRequest> = {}): ViewportHandoffWriteRequest {
  return {
    baseRevision: null,
    baseSelectedThreadRevision: 0,
    lastDeliberateActivityAt: null,
    lastSelectionActivityAt: null,
    sourceId: "browser-a",
    departureId: "departure-a",
    threadKey: "main",
    selectedThreadKey: "main",
    position: {
      scrollTop: 120,
      scrollHeight: 1_200,
      isAtBottom: false,
      anchorMessageId: "message-1",
      anchorTurnId: "turn-1",
      anchorOffsetTop: 24,
      lastSeenContentBottom: 1_100,
    },
    ...overrides,
  };
}

async function put(api: Hono, body: unknown) {
  return api.request("/sessions/1/viewport-handoff", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("session viewport handoff routes", () => {
  it("returns an empty full-session snapshot before the first departure", async () => {
    const { api } = await makeRoute({ leader: true });

    const response = await api.request("/sessions/1/viewport-handoff");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      state: {
        version: 1,
        sessionId: "session-1",
        revision: 0,
        selectedThreadKey: "main",
        handoffs: {},
      },
      serverNow: expect.any(Number),
    });
    expect(body).not.toHaveProperty("record");
  });

  it("publishes and reads leader Main, All, and quest handoffs without broadcasting", async () => {
    const { api, broadcastToSession } = await makeRoute({ leader: true });

    for (const [index, threadKey] of ["main", "all", "q-41"].entries()) {
      const response = await put(
        api,
        request({
          baseRevision: null,
          baseSelectedThreadRevision: index,
          sourceId: `browser-${index}`,
          departureId: `departure-${index}`,
          threadKey,
          selectedThreadKey: threadKey,
          position: { ...request().position, scrollTop: index * 100 },
        }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe("accepted");
    }

    const response = await api.request("/sessions/1/viewport-handoff?threadKey=Q-41");
    const body = await response.json();
    expect(body).toMatchObject({
      threadKey: "q-41",
      state: { revision: 3, selectedThreadKey: "q-41" },
      record: { threadKey: "q-41", revision: 3 },
      serverNow: expect.any(Number),
    });
    expect(Object.keys(body.state.handoffs)).toEqual(expect.arrayContaining(["main", "all", "q-41"]));
    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  it("keeps recent-departure deduplication metadata private in route responses", async () => {
    const { api, store } = await makeRoute({ leader: true });

    const writeResponse = await put(api, request());
    const writeBody = await writeResponse.json();
    expect(writeResponse.status).toBe(200);
    expect(writeBody).not.toHaveProperty("recentDepartures");
    expect(writeBody.state).not.toHaveProperty("recentDepartures");

    const persisted = JSON.parse(await readFile(store.filePathForTest("session-1"), "utf8"));
    expect(persisted.recentDepartures).toEqual([{ sourceId: "browser-a", departureId: "departure-a", revision: 1 }]);

    const fullReadBody = await (await api.request("/sessions/1/viewport-handoff")).json();
    expect(fullReadBody.state).not.toHaveProperty("recentDepartures");

    const threadReadBody = await (await api.request("/sessions/1/viewport-handoff?threadKey=main")).json();
    expect(threadReadBody.state).not.toHaveProperty("recentDepartures");
    expect(threadReadBody.record).not.toHaveProperty("recentDepartures");
  });

  it("returns stale and duplicate writes as successful caller-only outcomes", async () => {
    const { api } = await makeRoute({ leader: true });
    const first = await put(api, request());
    const firstBody = await first.json();
    const newer = await put(
      api,
      request({
        baseRevision: firstBody.record.revision,
        sourceId: "browser-b",
        departureId: "departure-b",
      }),
    );
    const newerBody = await newer.json();

    const stale = await put(
      api,
      request({
        baseRevision: firstBody.record.revision,
        departureId: "departure-stale",
        lastDeliberateActivityAt: newerBody.record.activityAt,
      }),
    );
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({
      status: "stale",
      state: { revision: 2 },
    });

    const duplicate = await put(
      api,
      request({
        baseRevision: firstBody.record.revision,
        lastDeliberateActivityAt: newerBody.record.updatedAt + 10_000,
      }),
    );
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({
      status: "duplicate",
      state: { revision: 2 },
    });
  });

  it("restricts non-leader sessions to the Main handoff", async () => {
    const { api } = await makeRoute({ leader: false });

    expect((await put(api, request())).status).toBe(200);
    expect((await put(api, request({ departureId: "q-write", threadKey: "q-41" }))).status).toBe(400);
    expect((await put(api, request({ departureId: "q-select", selectedThreadKey: "q-41" }))).status).toBe(400);
    expect((await api.request("/sessions/1/viewport-handoff?threadKey=all")).status).toBe(400);
  });

  it("rejects missing sessions and malformed writes", async () => {
    const { api } = await makeRoute({ leader: true });

    expect((await api.request("/sessions/missing/viewport-handoff")).status).toBe(404);
    expect((await put(api, { ...request(), position: { scrollTop: "bad" } })).status).toBe(400);
    expect((await put(api, { ...request(), baseRevision: -1 })).status).toBe(400);
  });

  it("fails closed on corrupt durable state instead of replacing it", async () => {
    const { api, store } = await makeRoute({ leader: true });
    const path = store.filePathForTest("session-1");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 99, sessionId: "session-1" }), "utf8");

    const readResponse = await api.request("/sessions/1/viewport-handoff");
    expect(readResponse.status).toBe(409);
    expect(await readResponse.json()).toMatchObject({ code: "invalid_state" });

    const writeResponse = await put(api, request());
    expect(writeResponse.status).toBe(409);
    expect(await readFile(path, "utf8")).toBe(JSON.stringify({ version: 99, sessionId: "session-1" }));
  });
});
