// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDraftsState } from "../shared/session-drafts.js";
import { applySessionDraftWrite } from "../server/bridge/session-drafts-controller.js";
import type { SessionNotification } from "../server/session-types.js";

// Draft sync between the user's browsers. "This tab" is the real store plus the
// real draft sync; the server is the real draft controller behind a mocked API;
// "another browser" writes to that server with its own client ID, and its
// broadcasts reach this tab the way the WebSocket handler delivers them.

const server = vi.hoisted(() => ({
  session: {
    id: "s1",
    notifications: [] as SessionNotification[],
    drafts: undefined as SessionDraftsState | undefined,
  },
  broadcasts: [] as Array<{ type: string; change: any }>,
  writes: [] as Array<{ sessionId: string; request: any; options: any }>,
  offline: false,
}));

vi.mock("./api/session-drafts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/session-drafts.js")>();
  return {
    ...actual,
    writeSessionDraft: vi.fn(async (sessionId: string, request: any, options: any = {}) => {
      server.writes.push({ sessionId, request, options });
      if (server.offline) throw new Error("offline");
      const result = applySessionDraftWrite(server.session, request, {
        broadcastToBrowsers: (_session, message) => server.broadcasts.push(message as any),
        persistSession: () => {},
      });
      if (!result.ok) throw new actual.DraftWriteRejectedError(result.error);
      return result.change;
    }),
    fetchSessionDrafts: vi.fn(async () => server.session.drafts ?? { revision: 0 }),
  };
});

import { useStore } from "./store.js";
import {
  DRAFT_SYNC_DELAY_MS,
  applyRemoteDraftChange,
  applySessionDraftsSnapshot,
  flushPendingDrafts,
  getDraftSyncClientId,
  resetDraftSyncForTests,
} from "./draft-sync.js";

const OTHER_BROWSER = "other-browser";

function needsInput(id: string, done = false): SessionNotification {
  return { id, category: "needs-input", summary: "Pick one", timestamp: 1, messageId: null, done };
}

/** Another browser writes a draft; the server broadcasts it and this tab receives it. */
function writeFromOtherBrowser(write: any) {
  const result = applySessionDraftWrite(
    server.session,
    { clientId: OTHER_BROWSER, write },
    { broadcastToBrowsers: (_s, message) => server.broadcasts.push(message as any), persistSession: () => {} },
  );
  if (!result.ok) throw new Error(result.error);
  applyRemoteDraftChange("s1", result.change);
  return result.change;
}

/** A page reload: the tab's memory is gone and the next subscribe delivers the server's drafts. */
function reload() {
  resetDraftSyncForTests();
  useStore.getState().reset();
  applySessionDraftsSnapshot("s1", server.session.drafts);
}

async function settle(ms = DRAFT_SYNC_DELAY_MS) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  server.session = { id: "s1", notifications: [needsInput("n-1")], drafts: undefined };
  server.broadcasts = [];
  server.writes = [];
  server.offline = false;
  resetDraftSyncForTests();
  useStore.getState().reset();
  localStorage.clear();
});

afterEach(() => {
  resetDraftSyncForTests();
  vi.useRealTimers();
});

describe("composer draft sync", () => {
  it("saves a draft after a pause in typing, so it survives a reload and shows in another browser", async () => {
    useStore.getState().setComposerDraft("s1", { text: "Started on desktop", images: [] });
    expect(server.writes).toHaveLength(0);

    await settle();

    expect(server.session.drafts?.composer?.draft).toEqual({ text: "Started on desktop" });
    expect(server.writes[0]?.request.clientId).toBe(getDraftSyncClientId());
    reload();
    expect(useStore.getState().composerDrafts.get("s1")?.text).toBe("Started on desktop");
  });

  it("sends steady typing at a bounded rate rather than per keystroke", async () => {
    // 30 keystrokes, 50 ms apart: 1.5 s of continuous typing.
    for (let i = 1; i <= 30; i++) {
      useStore.getState().setComposerDraft("s1", { text: "x".repeat(i), images: [] });
      await vi.advanceTimersByTimeAsync(50);
    }
    await settle();

    expect(server.writes.length).toBeLessThanOrEqual(3);
    expect(server.session.drafts?.composer?.draft.text).toBe("x".repeat(30));
  });

  it("does not send images that are still uploading, and keeps them when another browser's draft arrives", async () => {
    useStore.getState().setComposerDraft("s1", { text: "hi", images: [] });
    await settle();
    const image = { id: "img", name: "a.png", mediaType: "image/png", base64: "AAAA", status: "uploading" as const };
    useStore.getState().setComposerDraft("s1", { text: "hi", images: [image] });
    await settle();
    expect(server.writes).toHaveLength(1);

    writeFromOtherBrowser({ kind: "composer", draft: { text: "hi from phone" } });

    expect(useStore.getState().composerDrafts.get("s1")).toMatchObject({ text: "hi from phone", images: [image] });
  });

  it("shares an uploaded image by its server reference, with the agent path set by the server", async () => {
    const imageId = "1791000000000-7-a1b2c3";
    const uploaded = {
      id: "local-img",
      name: "desk.png",
      mediaType: "image/png",
      base64: "AAAA",
      status: "ready" as const,
      prepared: { imageRef: { imageId, media_type: "image/png" }, path: "/browser/claimed/path.png" },
    };
    useStore.getState().setComposerDraft("s1", { text: "look", images: [uploaded] });
    await settle();

    const syncedImage = server.session.drafts?.composer?.draft.images?.[0];
    expect(syncedImage?.imageRef).toEqual({ imageId, media_type: "image/png" });
    // The browser's path is replaced by the one image preparation derives.
    expect(syncedImage?.path).toMatch(new RegExp(`/s1/${imageId}\\.`));
    expect(syncedImage?.path).not.toBe("/browser/claimed/path.png");

    // Another device (simulated by a reload) gets the image as ready to send, without local bytes.
    reload();
    expect(useStore.getState().composerDrafts.get("s1")?.images).toEqual([
      {
        id: `synced-${imageId}`,
        name: "desk.png",
        mediaType: "image/png",
        base64: "",
        status: "ready",
        prepared: { imageRef: { imageId, media_type: "image/png" }, path: syncedImage?.path },
      },
    ]);
  });

  it("removes an image everywhere when another browser removes it, keeping this tab's own copy otherwise", async () => {
    const imageId = "1791000000000-8-d4e5f6";
    const ref = { imageId, media_type: "image/png" };
    const local = {
      id: "local-img",
      name: "desk.png",
      mediaType: "image/png",
      base64: "AAAA",
      status: "ready" as const,
      prepared: { imageRef: ref, path: "/p.png" },
    };
    useStore.getState().setComposerDraft("s1", { text: "two images", images: [local] });
    await settle();

    // The phone adds a second image: this tab keeps its own copy (with local bytes) and gains the new one.
    const phoneImage = {
      imageRef: { imageId: "1791000000000-9-0a0b0c", media_type: "image/jpeg" },
      name: "phone.jpg",
      path: "",
    };
    writeFromOtherBrowser({
      kind: "composer",
      draft: { text: "two images", images: [{ imageRef: ref, name: "desk.png", path: "" }, phoneImage] },
    });
    expect(
      useStore
        .getState()
        .composerDrafts.get("s1")
        ?.images.map((image) => image.id),
    ).toEqual(["local-img", "synced-1791000000000-9-0a0b0c"]);

    // The phone removes the desktop image: it disappears here too.
    writeFromOtherBrowser({ kind: "composer", draft: { text: "two images", images: [phoneImage] } });
    expect(
      useStore
        .getState()
        .composerDrafts.get("s1")
        ?.images.map((image) => image.id),
    ).toEqual(["synced-1791000000000-9-0a0b0c"]);
  });

  it("clears synced images everywhere when the message is sent", async () => {
    const image = {
      id: "local-img",
      name: "desk.png",
      mediaType: "image/png",
      base64: "AAAA",
      status: "ready" as const,
      prepared: { imageRef: { imageId: "1791000000000-3-abcdef", media_type: "image/png" }, path: "/p.png" },
    };
    useStore.getState().setComposerDraft("s1", { text: "", images: [image] });
    await settle();
    expect(server.session.drafts?.composer?.draft.images).toHaveLength(1);

    useStore.getState().clearComposerDraft("s1");
    await vi.advanceTimersByTimeAsync(0);

    expect(server.session.drafts?.composer).toBeUndefined();
  });

  it("clears the draft everywhere at once when the message is sent", async () => {
    useStore.getState().setComposerDraft("s1", { text: "about to send", images: [] });
    await settle();

    useStore.getState().clearComposerDraft("s1");
    await vi.advanceTimersByTimeAsync(0);

    expect(server.session.drafts?.composer).toBeUndefined();
    expect(server.broadcasts.at(-1)?.change).toMatchObject({ kind: "composer", draft: null });
  });

  it("shows another browser's edits live and ignores echoes of its own writes", async () => {
    writeFromOtherBrowser({ kind: "composer", draft: { text: "typed on the phone" } });
    expect(useStore.getState().composerDrafts.get("s1")?.text).toBe("typed on the phone");

    useStore.getState().setComposerDraft("s1", { text: "typed on the phone, then desktop", images: [] });
    await settle();
    // The server echoes this tab's own write; it must not disturb the tab.
    useStore.getState().setComposerDraft("s1", { text: "typed on the phone, then desktop, more", images: [] });
    applyRemoteDraftChange("s1", server.broadcasts.at(-1)!.change);
    expect(useStore.getState().composerDrafts.get("s1")?.text).toBe("typed on the phone, then desktop, more");
  });

  it("keeps this tab's unsent edit over a concurrent change, then the last write the server receives wins", async () => {
    useStore.getState().setComposerDraft("s1", { text: "desktop edit", images: [] });
    // The phone's change arrives while the desktop edit is still waiting to be sent.
    writeFromOtherBrowser({ kind: "composer", draft: { text: "phone edit" } });
    expect(useStore.getState().composerDrafts.get("s1")?.text).toBe("desktop edit");

    await settle();

    // The desktop write reached the server last, so it wins everywhere.
    expect(server.session.drafts?.composer?.draft.text).toBe("desktop edit");
    expect(useStore.getState().composerDrafts.get("s1")?.text).toBe("desktop edit");
  });

  it("adopts a concurrent change the server received after this tab's write", async () => {
    useStore.getState().setComposerDraft("s1", { text: "desktop edit", images: [] });
    await vi.advanceTimersByTimeAsync(DRAFT_SYNC_DELAY_MS - 1);
    // Hold the desktop write in flight, let the phone write land after it, then finish.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = await import("./api/session-drafts.js");
    const original = vi.mocked(api.writeSessionDraft).getMockImplementation()!;
    vi.mocked(api.writeSessionDraft).mockImplementationOnce(async (...args) => {
      const change = await original(...args);
      await gate;
      return change;
    });
    await vi.advanceTimersByTimeAsync(1);
    writeFromOtherBrowser({ kind: "composer", draft: { text: "phone edit, later" } });
    expect(useStore.getState().composerDrafts.get("s1")?.text).toBe("desktop edit");

    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(useStore.getState().composerDrafts.get("s1")?.text).toBe("phone edit, later");
  });

  it("retries while offline and keeps the local draft over the snapshot on reconnect", async () => {
    server.offline = true;
    useStore.getState().setComposerDraft("s1", { text: "written offline", images: [] });
    await settle();
    expect(server.session.drafts).toBeUndefined();

    // Reconnect delivers a snapshot without the draft; the unsent local edit stays.
    applySessionDraftsSnapshot("s1", server.session.drafts);
    expect(useStore.getState().composerDrafts.get("s1")?.text).toBe("written offline");

    server.offline = false;
    await settle(5000);
    expect(server.session.drafts?.composer?.draft.text).toBe("written offline");
  });

  it("flushes pending drafts with keepalive when the page is hidden", async () => {
    useStore.getState().setComposerDraft("s1", { text: "switching apps", images: [] });

    flushPendingDrafts({ keepalive: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(server.writes[0]?.options).toEqual({ keepalive: true });
    expect(server.session.drafts?.composer?.draft.text).toBe("switching apps");
  });

  it("moves report comments the previous build saved in this browser into the synced draft", async () => {
    localStorage.setItem("cc-server-id", "server-one");
    const reportSource = {
      sessionId: "worker",
      reportId: "report-fixture",
      sourcePath: "/tmp/report.md",
      sha256: "a".repeat(64),
      responsibleWorkerId: "worker",
    };
    localStorage.setItem(
      "server-one:report-comment-draft:s1",
      JSON.stringify({
        text: "Follow up",
        reportRecipientSessionId: "worker",
        annotations: [{ id: "c1", selectedText: "one hour", comment: "Why?", reportSource }],
      }),
    );

    applySessionDraftsSnapshot("s1", undefined);
    await settle();

    expect(localStorage.getItem("server-one:report-comment-draft:s1")).toBeNull();
    expect(server.session.drafts?.composer?.draft).toMatchObject({
      text: "Follow up",
      reportRecipientSessionId: "worker",
      annotations: [expect.objectContaining({ id: "c1" })],
    });
  });
});

describe("needs-input draft sync", () => {
  it("shares answers across browsers and reloads", async () => {
    useStore.getState().setNeedsInputDraftAnswer("s1", "n-1", "0", "yes");
    await settle();

    reload();
    expect(useStore.getState().needsInputDrafts.get("s1")?.get("n-1")).toEqual({ "0": "yes" });

    writeFromOtherBrowser({ kind: "needs-input", notificationId: "n-1", answers: { "0": "yes", "1": "from phone" } });
    expect(useStore.getState().needsInputDrafts.get("s1")?.get("n-1")).toEqual({ "0": "yes", "1": "from phone" });
  });

  it("clears the draft on submit and drops drafts of prompts resolved elsewhere", async () => {
    server.session.notifications = [needsInput("n-1"), needsInput("n-2")];
    useStore.getState().setNeedsInputDraftAnswer("s1", "n-1", "0", "yes");
    useStore.getState().setNeedsInputDraftAnswer("s1", "n-2", "0", "maybe");
    await settle();

    useStore.getState().clearNeedsInputDraft("s1", "n-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(server.session.drafts?.needsInput?.["n-1"]).toBeUndefined();

    // n-2 is answered on another device; this tab's next snapshot drops its copy.
    server.session.notifications = [needsInput("n-1", true), needsInput("n-2", true)];
    const { getSessionDraftsSnapshot } = await import("../server/bridge/session-drafts-controller.js");
    applySessionDraftsSnapshot("s1", getSessionDraftsSnapshot(server.session));
    expect(useStore.getState().needsInputDrafts.get("s1")).toBeUndefined();
  });
});
