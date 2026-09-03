import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewportHandoffStore } from "../viewport-handoff-store.js";
import { registerSessionExtraRoutes } from "./session-extra-routes.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeApp(deleteStatus: 200 | 500 = 200) {
  const root = await mkdtemp(join(tmpdir(), "takode-session-extra-viewport-"));
  roots.push(root);
  const sessionId = "session-1";
  const launcherSession = {
    sessionId,
    isOrchestrator: true,
    cwd: "/repo",
    createdAt: 1,
  };
  const api = new Hono();
  registerSessionExtraRoutes(api, {
    launcher: { getSession: vi.fn(() => launcherSession) } as any,
    wsBridge: { getSession: vi.fn(() => null) } as any,
    sessionStore: { directory: root } as any,
    resolveId: (raw: string) => (raw === "1" || raw === sessionId ? sessionId : null),
    authenticateTakodeCaller: vi.fn() as any,
  });
  api.delete("/sessions/:id", (c) => c.json(deleteStatus === 200 ? { ok: true } : { error: "failed" }, deleteStatus));
  return { api, root, sessionId };
}

function handoffBody() {
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
      scrollTop: 100,
      scrollHeight: 1_000,
      isAtBottom: false,
      anchorMessageId: "message-1",
      anchorTurnId: "turn-1",
      anchorOffsetTop: 20,
      lastSeenContentBottom: 900,
    },
  };
}

async function publish(api: Hono) {
  return api.request("/sessions/1/viewport-handoff", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(handoffBody()),
  });
}

describe("session extra viewport handoff cleanup", () => {
  it("removes the sidecar only after a successful session deletion", async () => {
    const { api, root, sessionId } = await makeApp();
    expect((await publish(api)).status).toBe(200);
    const path = new ViewportHandoffStore(join(root, "viewport-handoffs")).filePathForTest(sessionId);
    await access(path);

    const response = await api.request("/sessions/1", { method: "DELETE" });

    expect(response.status).toBe(200);
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the sidecar when session deletion fails", async () => {
    const { api, root, sessionId } = await makeApp(500);
    expect((await publish(api)).status).toBe(200);
    const path = new ViewportHandoffStore(join(root, "viewport-handoffs")).filePathForTest(sessionId);

    const response = await api.request("/sessions/1", { method: "DELETE" });

    expect(response.status).toBe(500);
    await access(path);
  });
});
