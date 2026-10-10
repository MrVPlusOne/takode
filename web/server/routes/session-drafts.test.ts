import { describe, expect, it, vi } from "vitest";
import type { SessionDraftsState } from "../../shared/session-drafts.js";
import type { SessionNotification } from "../session-types.js";
import { createSessionDraftRoutes } from "./session-drafts.js";

// Drafts the server keeps so every browser of the user shares them. These tests
// drive the real routes against a minimal bridge: writes are numbered, broadcast
// to the session's browsers and persisted; needs-input drafts end with their prompt.

function needsInput(id: string, done = false): SessionNotification {
  return { id, category: "needs-input", summary: "Pick one", timestamp: 1, messageId: null, done };
}

function setup(notifications: SessionNotification[] = [needsInput("n-1")]) {
  const session: { id: string; notifications: SessionNotification[]; drafts?: SessionDraftsState } = {
    id: "s1",
    notifications,
  };
  const broadcastToSession = vi.fn();
  const persistSessionById = vi.fn();
  const wsBridge = {
    getSession: (id: string) => (id === "s1" ? session : undefined),
    broadcastToSession,
    persistSessionById,
  };
  const app = createSessionDraftRoutes({ wsBridge: wsBridge as any, resolveId: (raw) => raw });
  const put = (body: unknown) =>
    app.request("/sessions/s1/drafts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { session, app, put, broadcastToSession, persistSessionById };
}

describe("session draft routes", () => {
  it("stores a composer draft, numbers it, persists it and broadcasts it to the session's browsers", async () => {
    const { session, app, put, broadcastToSession, persistSessionById } = setup();

    const response = await put({
      clientId: "tab-a",
      write: { kind: "composer", draft: { text: "Hello from desktop" } },
    });

    expect(response.status).toBe(200);
    const { change } = await response.json();
    expect(change).toMatchObject({
      kind: "composer",
      draft: { text: "Hello from desktop" },
      revision: 1,
      clientId: "tab-a",
    });
    expect(session.drafts?.composer?.draft.text).toBe("Hello from desktop");
    expect(persistSessionById).toHaveBeenCalledWith("s1");
    expect(broadcastToSession).toHaveBeenCalledWith("s1", { type: "session_draft_update", change });

    // A second browser loading the session reads the same draft.
    const snapshot = await (await app.request("/sessions/s1/drafts")).json();
    expect(snapshot.drafts.composer.draft.text).toBe("Hello from desktop");
  });

  it("orders competing writes by arrival: the later write wins and gets the higher revision", async () => {
    const { session, put } = setup();

    await put({ clientId: "tab-a", write: { kind: "composer", draft: { text: "desktop" } } });
    const later = await (
      await put({ clientId: "tab-b", write: { kind: "composer", draft: { text: "phone" } } })
    ).json();

    expect(later.change.revision).toBe(2);
    expect(session.drafts?.composer).toMatchObject({ draft: { text: "phone" }, clientId: "tab-b", revision: 2 });
  });

  it("treats an empty composer draft as cleared", async () => {
    const { session, put } = setup();
    await put({ clientId: "tab-a", write: { kind: "composer", draft: { text: "sent soon" } } });

    const { change } = await (
      await put({ clientId: "tab-a", write: { kind: "composer", draft: { text: "" } } })
    ).json();

    expect(change.draft).toBeNull();
    expect(session.drafts).toEqual({ revision: 2 });
  });

  it("keeps needs-input answers per prompt and refuses new answers for a resolved prompt", async () => {
    const { session, put } = setup([needsInput("n-1"), needsInput("n-2", true)]);

    const ok = await put({
      clientId: "tab-a",
      write: { kind: "needs-input", notificationId: "n-1", answers: { "0": "yes" } },
    });
    const resolved = await put({
      clientId: "tab-a",
      write: { kind: "needs-input", notificationId: "n-2", answers: { "0": "too late" } },
    });

    expect(ok.status).toBe(200);
    expect(resolved.status).toBe(409);
    expect(session.drafts?.needsInput).toEqual({
      "n-1": expect.objectContaining({ answers: { "0": "yes" }, clientId: "tab-a" }),
    });
  });

  it("drops a needs-input draft from snapshots once its prompt is resolved", async () => {
    const { session, app, put } = setup();
    await put({ clientId: "tab-a", write: { kind: "needs-input", notificationId: "n-1", answers: { "0": "yes" } } });

    session.notifications = [needsInput("n-1", true)];
    const snapshot = await (await app.request("/sessions/s1/drafts")).json();

    expect(snapshot.drafts).toEqual({ revision: 1 });
    expect(session.drafts?.needsInput).toBeUndefined();
  });

  it("rejects malformed and oversized writes", async () => {
    const { put } = setup();

    expect((await put({ write: { kind: "composer", draft: { text: "x" } } })).status).toBe(400);
    expect((await put({ clientId: "tab-a", write: { kind: "other" } })).status).toBe(400);
    expect(
      (await put({ clientId: "tab-a", write: { kind: "composer", draft: { text: "x".repeat(200_001) } } })).status,
    ).toBe(400);
  });

  it("returns 404 for an unknown session", async () => {
    const { app } = setup();
    expect((await app.request("/sessions/missing/drafts")).status).toBe(404);
  });

  it("stores uploaded draft images with the server's own attachment path", async () => {
    const { session, put } = setup();
    const imageId = "1791000000000-1-abc123";

    const response = await put({
      clientId: "tab-a",
      write: {
        kind: "composer",
        draft: {
          text: "",
          images: [{ imageRef: { imageId, media_type: "image/png" }, name: "shot.png", path: "/etc/passwd" }],
        },
      },
    });

    expect(response.status).toBe(200);
    const image = session.drafts?.composer?.draft.images?.[0];
    expect(image).toMatchObject({ imageRef: { imageId, media_type: "image/png" }, name: "shot.png" });
    // The agent is told to read this path, so it comes from the image ID, never the browser.
    expect(image?.path).toMatch(new RegExp(`/s1/${imageId}\\.`));
  });

  it("rejects draft images whose ID could escape the attachment folder", async () => {
    const { put } = setup();

    const response = await put({
      clientId: "tab-a",
      write: {
        kind: "composer",
        draft: { text: "", images: [{ imageRef: { imageId: "../../secret", media_type: "image/png" }, name: "x" }] },
      },
    });

    expect(response.status).toBe(400);
  });
});
