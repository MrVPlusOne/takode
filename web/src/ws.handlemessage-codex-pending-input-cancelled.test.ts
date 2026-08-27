// @vitest-environment jsdom

import type { SessionState, PermissionRequest, ContentBlock, BrowserIncomingMessage } from "./types.js";
import { computeHistoryMessagesSyncHash } from "../shared/history-sync-hash.js";
import { HISTORY_WINDOW_SECTION_TURN_COUNT, HISTORY_WINDOW_VISIBLE_SECTION_COUNT } from "../shared/history-window.js";

// Mock the names utility before any imports
vi.mock("./utils/names.js", () => ({
  generateUniqueSessionName: vi.fn(() => "Test Session"),
}));

const getDiffStatsMock = vi.fn().mockResolvedValue({ stats: {} });
const listSessionsMock = vi.fn().mockResolvedValue([]);
const playNotificationSoundMock = vi.hoisted(() => vi.fn());

// Mock the API module so PostHog doesn't break in jsdom
vi.mock("./api.js", () => ({
  api: {
    getDiffStats: getDiffStatsMock,
    listSessions: listSessionsMock,
  },
}));

vi.mock("./utils/notification-sound.js", () => ({
  playNotificationSound: playNotificationSoundMock,
}));

let wsModule: typeof import("./ws.js");
let useStore: typeof import("./store.js").useStore;

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------
let lastWs: InstanceType<typeof MockWebSocket>;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;
  OPEN = 1;
  CLOSED = 3;
  CONNECTING = 0;
  CLOSING = 2;
  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastWs = this;
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("location", { protocol: "http:", host: "localhost:3456" });

// ---------------------------------------------------------------------------
// Fresh module state for each test
// ---------------------------------------------------------------------------
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  getDiffStatsMock.mockReset();
  getDiffStatsMock.mockResolvedValue({ stats: {} });
  listSessionsMock.mockReset();
  listSessionsMock.mockResolvedValue([]);
  playNotificationSoundMock.mockReset();
  MockWebSocket.instances = [];

  const storeModule = await import("./store.js");
  useStore = storeModule.useStore;
  useStore.getState().reset();
  localStorage.clear();

  wsModule = await import("./ws.js");
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSession(id: string): SessionState {
  return {
    session_id: id,
    model: "claude-opus-4-20250514",
    cwd: "/home/user",
    tools: ["Bash", "Read"],
    permissionMode: "default",
    claude_code_version: "2.1.0",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/home/user",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

function fireMessage(data: Record<string, unknown>) {
  lastWs.onmessage!({ data: JSON.stringify(data) });
}

// ===========================================================================
// Connection
// ===========================================================================
describe("handleMessage: codex_pending_input_cancelled", () => {
  it("adopts the initial authoritative pending snapshot after browser reconnect", () => {
    useStore.getState().addPendingUserUpload("s1", {
      id: "pending-upload-reconnect",
      content: "retain this queued image",
      timestamp: Date.now(),
      stage: "delivering",
      threadKey: "q-1958",
      questId: "q-1958",
      images: [],
    });

    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    fireMessage({
      type: "codex_pending_inputs",
      inputs: [
        {
          id: "server-pending-reconnect",
          clientMsgId: "pending-upload-reconnect",
          content: "retain this queued image",
          timestamp: Date.now(),
          cancelable: true,
          threadKey: "q-1958",
          questId: "q-1958",
        },
      ],
    });

    fireMessage({ type: "message_history", messages: [] });

    expect(useStore.getState().pendingUserUploads.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingUserUploadRestorations.get("s1")?.has("pending-upload-reconnect")).toBe(true);
    expect(
      useStore
        .getState()
        .pendingCodexInputs.get("s1")
        ?.map((input) => input.id),
    ).toEqual(["server-pending-reconnect"]);
  });

  it("retires the matching server pending row as soon as its live user message commits", () => {
    useStore.getState().addPendingUserUpload("s1", {
      id: "pending-client-live",
      content: "commit this exact owner",
      timestamp: Date.now(),
      stage: "delivering",
      images: [],
    });

    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    fireMessage({
      type: "codex_pending_inputs",
      inputs: [
        {
          id: "server-pending-live",
          clientMsgId: "pending-client-live",
          content: "commit this exact owner",
          timestamp: Date.now(),
          cancelable: false,
        },
        {
          id: "server-pending-later",
          clientMsgId: "pending-client-later",
          content: "preserve this later owner",
          timestamp: Date.now(),
          cancelable: true,
        },
      ],
    });

    fireMessage({
      type: "user_message",
      id: "server-pending-live",
      client_msg_id: "pending-client-live",
      content: "commit this exact owner",
      timestamp: Date.now(),
    });

    expect(useStore.getState().pendingUserUploads.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingUserUploadRestorations.get("s1")).toBeUndefined();
    expect(
      useStore
        .getState()
        .pendingCodexInputs.get("s1")
        ?.map((input) => input.id),
    ).toEqual(["server-pending-later"]);
    expect(
      useStore
        .getState()
        .messages.get("s1")
        ?.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });

  it("marks an exact local composer owner failed when oversized input is rejected before admission", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    useStore.getState().addPendingUserUpload("s1", {
      id: "pending-text-oversized",
      content: "oversized text owner",
      timestamp: Date.now(),
      stage: "delivering",
      threadKey: "q-1958",
      questId: "q-1958",
      images: [],
      prepared: { deliveryContent: "oversized text owner", imageRefs: [] },
    });

    fireMessage({
      type: "codex_pending_input_failed",
      input: {
        id: "server-rejected-oversized",
        clientMsgId: "pending-text-oversized",
        content: "oversized text owner",
        timestamp: Date.now(),
        cancelable: false,
        threadKey: "q-1958",
        questId: "q-1958",
      },
      reason: "pending_input_too_large",
      message: "Codex input is too large to queue safely. The message was not sent to Codex.",
    });

    expect(useStore.getState().pendingCodexInputs.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingUserUploadRestorations.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingUserUploads.get("s1")).toEqual([
      expect.objectContaining({
        id: "pending-text-oversized",
        content: "oversized text owner",
        stage: "failed",
        error: "Codex input is too large to queue safely. The message was not sent to Codex.",
        prepared: undefined,
      }),
    ]);
  });

  it("restores draft images into the composer when a pending Codex input is cancelled", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({
      type: "codex_pending_input_cancelled",
      input: {
        id: "pending-1",
        content: "restore this image",
        timestamp: Date.now(),
        cancelable: true,
        replyContext: { messageId: "reply-target-server", previewText: "Authoritative prompt" },
        draftImages: [
          {
            name: "attachment-1.png",
            base64: "restore-image-data",
            mediaType: "image/png",
          },
        ],
      },
    });

    const draft = useStore.getState().composerDrafts.get("s1");
    expect(draft).toEqual({
      text: "restore this image",
      images: [
        expect.objectContaining({
          name: "attachment-1.png",
          base64: "restore-image-data",
          mediaType: "image/png",
          status: "uploading",
        }),
      ],
    });
    expect(useStore.getState().replyContexts.get("s1")).toEqual({
      messageId: "reply-target-server",
      previewText: "Authoritative prompt",
    });
  });

  it("removes an active local send card when cancellation arrives before a pending snapshot", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    useStore.getState().addPendingUserUpload("s1", {
      id: "pending-upload-cancel-early",
      content: "restore this early cancellation",
      timestamp: Date.now(),
      stage: "delivering",
      images: [
        {
          id: "draft-image-cancel-early",
          name: "early.png",
          base64: "early-image-data",
          mediaType: "image/png",
          status: "ready",
          prepared: {
            imageRef: { imageId: "img-early", media_type: "image/png" },
            path: "/tmp/early.png",
          },
        },
      ],
    });

    fireMessage({
      type: "codex_pending_input_cancelled",
      input: {
        id: "server-pending-early",
        clientMsgId: "pending-upload-cancel-early",
        content: "restore this early cancellation",
        timestamp: Date.now(),
        cancelable: true,
      },
    });

    expect(useStore.getState().pendingUserUploads.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingUserUploadRestorations.get("s1")).toBeUndefined();
    expect(useStore.getState().composerDrafts.get("s1")).toEqual({
      text: "restore this early cancellation",
      images: [
        expect.objectContaining({
          id: "draft-image-cancel-early",
          name: "early.png",
          status: "ready",
        }),
      ],
    });
  });

  it("does not create a partial text-only draft when another browser cancels an image message", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({
      type: "codex_pending_input_cancelled",
      input: {
        id: "pending-non-origin-image",
        clientMsgId: "pending-client-other-browser",
        content: "keep this screenshot attached",
        timestamp: Date.now(),
        cancelable: true,
        replyContext: { messageId: "reply-target-other-browser", previewText: "Original prompt" },
        imageRefs: [{ imageId: "img-other-browser", media_type: "image/png" }],
      },
    });

    expect(useStore.getState().composerDrafts.get("s1")).toBeUndefined();
    expect(useStore.getState().replyContexts.get("s1")).toBeUndefined();
  });

  it("restores browser-local upload images when a cancelled pending Codex input no longer carries draftImages", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    useStore.getState().addPendingUserUpload("s1", {
      id: "pending-upload-restore-1",
      content: "restore this image",
      timestamp: Date.now(),
      stage: "delivering",
      replyContext: { messageId: "reply-target-local", previewText: "Locally retained prompt" },
      images: [
        {
          id: "draft-image-restore-1",
          name: "attachment-1.png",
          base64: "restore-image-data",
          mediaType: "image/png",
          status: "ready",
          prepared: {
            imageRef: { imageId: "img-1", media_type: "image/png" },
            path: "/tmp/img.png",
          },
        },
      ],
      prepared: {
        deliveryContent:
          "restore this image\n[📎 Image attachments -- read these files with the Read tool before responding:\nAttachment 1: /tmp/img.png]",
        imageRefs: [{ imageId: "img-1", media_type: "image/png" }],
      },
    });

    fireMessage({
      type: "codex_pending_inputs",
      inputs: [
        {
          id: "pending-restore-1",
          clientMsgId: "pending-upload-restore-1",
          content: "restore this image",
          timestamp: Date.now(),
          cancelable: true,
          imageRefs: [{ imageId: "img-1", media_type: "image/png" }],
        },
      ],
    });

    expect(useStore.getState().pendingUserUploads.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingUserUploadRestorations.get("s1")?.has("pending-upload-restore-1")).toBe(true);

    fireMessage({
      type: "codex_pending_input_cancelled",
      input: {
        id: "pending-restore-1",
        clientMsgId: "pending-upload-restore-1",
        content: "restore this image",
        timestamp: Date.now(),
        cancelable: true,
      },
    });

    expect(useStore.getState().pendingUserUploads.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingUserUploadRestorations.get("s1")).toBeUndefined();
    const draft = useStore.getState().composerDrafts.get("s1");
    expect(draft).toEqual({
      text: "restore this image",
      images: [
        expect.objectContaining({
          id: "draft-image-restore-1",
          name: "attachment-1.png",
          base64: "restore-image-data",
          mediaType: "image/png",
          status: "ready",
          prepared: {
            imageRef: { imageId: "img-1", media_type: "image/png" },
            path: "/tmp/img.png",
          },
        }),
      ],
    });
    expect(useStore.getState().replyContexts.get("s1")).toEqual({
      messageId: "reply-target-local",
      previewText: "Locally retained prompt",
    });
  });
});
