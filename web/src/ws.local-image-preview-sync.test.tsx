// @vitest-environment jsdom

import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, PendingUserUpload, SessionState } from "./types.js";
import { useStore } from "./store.js";
import { createWsMessageHandler } from "./ws-handlers.js";
import { MessageBubble } from "./components/MessageBubble.js";
import { buildThreadWindowSync } from "../shared/thread-window.js";

const apiMocks = vi.hoisted(() => ({
  getDiffStats: vi.fn().mockResolvedValue({ stats: {} }),
  listSessions: vi.fn().mockResolvedValue([]),
  markNotificationDone: vi.fn(async () => ({})),
  revertToMessage: vi.fn(async () => ({})),
  starMessage: vi.fn(async () => ({})),
  unstarMessage: vi.fn(async () => ({})),
  getFsImageUrl: vi.fn((path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`),
}));

vi.mock("./api.js", () => ({ api: apiMocks }));
vi.mock("./utils/notification-sound.js", () => ({ playNotificationSound: vi.fn() }));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: {} }));

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession: vi.fn(() => true) });
const SESSION_ID = "local-preview-session";
const CLIENT_MSG_ID = "origin-browser-client-message";
const MESSAGE_ID = "origin-browser-user-message";

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
});

beforeEach(() => {
  useStore.getState().reset();
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  let nextUrl = 0;
  createObjectURL.mockImplementation(() => `blob:local-preview-${++nextUrl}`);
  handleMessage(SESSION_ID, { type: "session_init", session: session() });
});

function session(): SessionState {
  return {
    session_id: SESSION_ID,
    model: "claude-opus-4-20250514",
    cwd: "/tmp/takode",
    tools: [],
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
    repo_root: "/tmp/takode",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

function imageRefs() {
  return [
    { imageId: "image-a", media_type: "image/png" as const, sourceName: "first.png" },
    { imageId: "image-b", media_type: "image/jpeg" as const, sourceName: "second.jpg" },
  ];
}

function pendingUpload(): PendingUserUpload {
  const refs = imageRefs();
  return {
    id: CLIENT_MSG_ID,
    content: "Inspect both images",
    timestamp: 1_000,
    stage: "delivering",
    images: [
      {
        id: "draft-a",
        name: "first.png",
        base64: "AQID",
        mediaType: "image/png",
        status: "ready",
        prepared: { imageRef: refs[0]!, path: "/tmp/first.png" },
      },
      {
        id: "draft-b",
        name: "second.jpg",
        base64: "BAUG",
        mediaType: "image/jpeg",
        status: "ready",
        prepared: { imageRef: refs[1]!, path: "/tmp/second.jpg" },
      },
    ],
    prepared: { deliveryContent: "Inspect both images", imageRefs: refs },
  };
}

function committedMessage(overrides: Partial<Extract<BrowserIncomingMessage, { type: "user_message" }>> = {}) {
  return {
    type: "user_message" as const,
    id: MESSAGE_ID,
    client_msg_id: CLIENT_MSG_ID,
    content: "Inspect both images",
    timestamp: 1_001,
    images: imageRefs(),
    ...overrides,
  };
}

function historyWindow(message = committedMessage()): Extract<BrowserIncomingMessage, { type: "history_window_sync" }> {
  return {
    type: "history_window_sync",
    messages: [message],
    window: {
      from_turn: 0,
      turn_count: 1,
      total_turns: 1,
      has_older_items: false,
      has_newer_items: false,
      start_index: 0,
      section_turn_count: 10,
      visible_section_count: 1,
    },
  };
}

function threadWindow(message = committedMessage()): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const routedMessage = {
    ...message,
    threadKey: "q-2039",
    questId: "q-2039",
    threadRefs: [{ threadKey: "q-2039", questId: "q-2039", source: "explicit" as const }],
  };
  const built = buildThreadWindowSync({
    messageHistory: [routedMessage],
    threadKey: "q-2039",
    fromItem: 0,
    itemCount: 1,
    sectionItemCount: 10,
    visibleItemCount: 1,
  });
  return {
    type: "thread_window_sync",
    thread_key: built.threadKey,
    entries: built.entries,
    window: built.window,
  };
}

function previewUrls(messages: readonly { localImages?: Array<{ previewUrl?: string }> }[] | undefined): string[] {
  return messages?.[0]?.localImages?.flatMap((image) => (image.previewUrl ? [image.previewUrl] : [])) ?? [];
}

describe("origin-browser local image previews across authoritative windows", () => {
  it("keeps the same two object URLs through repeated history and selected-thread replacements", () => {
    // Producer sequence: local owner -> live committed row -> canonical bounded history -> selected thread window.
    useStore.getState().addPendingUserUpload(SESSION_ID, pendingUpload());
    handleMessage(SESSION_ID, committedMessage());

    const initialUrls = previewUrls(useStore.getState().messages.get(SESSION_ID));
    expect(initialUrls).toEqual(["blob:local-preview-1", "blob:local-preview-2"]);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(useStore.getState().pendingUserUploads.has(SESSION_ID)).toBe(false);
    expect(useStore.getState().pendingUserUploadRestorations.has(SESSION_ID)).toBe(false);

    handleMessage(SESSION_ID, historyWindow());
    expect(previewUrls(useStore.getState().messages.get(SESSION_ID))).toEqual(initialUrls);

    handleMessage(SESSION_ID, historyWindow());
    expect(previewUrls(useStore.getState().messages.get(SESSION_ID))).toEqual(initialUrls);

    handleMessage(SESSION_ID, threadWindow());
    expect(previewUrls(useStore.getState().threadWindowMessages.get(SESSION_ID)?.get("q-2039"))).toEqual(initialUrls);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("keeps other-browser and historical windows on ordered backend thumbnail refs", () => {
    handleMessage(SESSION_ID, historyWindow());
    const message = useStore.getState().messages.get(SESSION_ID)?.[0];

    expect(message?.localImages).toBeUndefined();
    expect(message?.images?.map((image) => image.imageId)).toEqual(["image-a", "image-b"]);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("renders origin previews without placeholders or backend thumbnail sources after each replacement", () => {
    useStore.getState().addPendingUserUpload(SESSION_ID, pendingUpload());
    handleMessage(SESSION_ID, committedMessage());

    const view = render(
      <MessageBubble message={useStore.getState().messages.get(SESSION_ID)![0]!} sessionId={SESSION_ID} />,
    );
    let group = screen.getByTestId("user-image-preview-group");
    expect(within(group).getAllByRole("button", { name: /^Open image / })).toHaveLength(2);
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();
    expect(
      within(group)
        .getAllByTestId("image-preview-thumbnail-image")
        .map((image) => image.getAttribute("src")),
    ).toEqual(["blob:local-preview-1", "blob:local-preview-2"]);

    handleMessage(SESSION_ID, historyWindow());
    view.rerender(<MessageBubble message={useStore.getState().messages.get(SESSION_ID)![0]!} sessionId={SESSION_ID} />);
    group = screen.getByTestId("user-image-preview-group");
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();
    expect(group.querySelector('img[src^="/api/images/"]')).toBeNull();

    handleMessage(SESSION_ID, threadWindow());
    view.rerender(
      <MessageBubble
        message={useStore.getState().threadWindowMessages.get(SESSION_ID)!.get("q-2039")![0]!}
        sessionId={SESSION_ID}
      />,
    );
    group = screen.getByTestId("user-image-preview-group");
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();
    expect(group.querySelector('img[src^="/api/images/"]')).toBeNull();
  });

  it("renders a fresh browser's historical attachments through the normal backend thumbnail path", () => {
    handleMessage(SESSION_ID, historyWindow());
    render(<MessageBubble message={useStore.getState().messages.get(SESSION_ID)![0]!} sessionId={SESSION_ID} />);

    const group = screen.getByTestId("user-image-preview-group");
    expect(within(group).getAllByTestId("image-preview-loading-placeholder")).toHaveLength(2);
    const images = within(group).getAllByTestId("image-preview-thumbnail-image");
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      `/api/images/${SESSION_ID}/image-a/thumb`,
      `/api/images/${SESSION_ID}/image-b/thumb`,
    ]);

    fireEvent.load(images[0]!);
    fireEvent.load(images[1]!);
    expect(within(group).getAllByRole("button", { name: /^Open image / })).toHaveLength(2);
  });

  it("retires settled preview state while the mounted UI keeps decoded blobs until unmount", async () => {
    useStore.getState().addPendingUserUpload(SESSION_ID, pendingUpload());
    handleMessage(SESSION_ID, committedMessage());

    function StoredMessage() {
      const message = useStore((state) => state.messages.get(SESSION_ID)?.[0]);
      return message ? <MessageBubble message={message} sessionId={SESSION_ID} /> : null;
    }

    const view = render(<StoredMessage />);
    let thumbnails = screen.getAllByTestId("image-preview-thumbnail-image");
    fireEvent.load(thumbnails[0]!);
    fireEvent.load(thumbnails[1]!);

    await waitFor(() => expect(useStore.getState().messages.get(SESSION_ID)?.[0]?.localImages).toBeUndefined());
    thumbnails = screen.getAllByTestId("image-preview-thumbnail-image");
    expect(thumbnails.map((image) => image.getAttribute("src"))).toEqual([
      "blob:local-preview-1",
      "blob:local-preview-2",
    ]);
    expect(screen.queryByTestId("image-preview-loading-placeholder")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    view.unmount();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(2));
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(["blob:local-preview-1", "blob:local-preview-2"]);
  });

  it("waits for every mounted owner before retiring shared previews and revokes after the last owner unmounts", async () => {
    useStore.getState().addPendingUserUpload(SESSION_ID, pendingUpload());
    handleMessage(SESSION_ID, committedMessage());

    function StoredMessage({ viewId }: { viewId: string }) {
      const message = useStore((state) => state.messages.get(SESSION_ID)?.[0]);
      return message ? (
        <section data-testid={viewId}>
          <MessageBubble message={message} sessionId={SESSION_ID} />
        </section>
      ) : null;
    }

    function MountedViews({ showA = true, showB = true }: { showA?: boolean; showB?: boolean }) {
      return (
        <StrictMode>
          {showA && <StoredMessage viewId="preview-view-a" />}
          {showB && <StoredMessage viewId="preview-view-b" />}
        </StrictMode>
      );
    }

    const view = render(<MountedViews />);
    const viewA = screen.getByTestId("preview-view-a");
    const viewB = screen.getByTestId("preview-view-b");

    for (const thumbnail of within(viewA).getAllByTestId("image-preview-thumbnail-image")) {
      fireEvent.load(thumbnail);
    }

    expect(
      useStore
        .getState()
        .messages.get(SESSION_ID)?.[0]
        ?.localImages?.map((image) => image.imageId),
    ).toEqual(["image-a", "image-b"]);
    expect(
      within(viewB)
        .getAllByTestId("image-preview-thumbnail-image")
        .map((image) => image.getAttribute("src")),
    ).toEqual(["blob:local-preview-1", "blob:local-preview-2"]);
    expect(within(viewB).queryByTestId("image-preview-loading-placeholder")).toBeNull();

    const viewBThumbnails = within(viewB).getAllByTestId("image-preview-thumbnail-image");
    fireEvent.load(viewBThumbnails[0]!);
    await waitFor(() =>
      expect(
        useStore
          .getState()
          .messages.get(SESSION_ID)?.[0]
          ?.localImages?.map((image) => image.imageId),
      ).toEqual(["image-b"]),
    );
    fireEvent.load(within(viewB).getAllByTestId("image-preview-thumbnail-image")[1]!);
    await waitFor(() => expect(useStore.getState().messages.get(SESSION_ID)?.[0]?.localImages).toBeUndefined());

    for (const owner of [viewA, viewB]) {
      expect(
        within(owner)
          .getAllByTestId("image-preview-thumbnail-image")
          .map((image) => image.getAttribute("src")),
      ).toEqual(["blob:local-preview-1", "blob:local-preview-2"]);
      expect(within(owner).queryByTestId("image-preview-loading-placeholder")).toBeNull();
    }
    expect(revokeObjectURL).not.toHaveBeenCalled();

    view.rerender(<MountedViews showA={false} />);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    view.rerender(<MountedViews showA={false} showB={false} />);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(2));
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(["blob:local-preview-1", "blob:local-preview-2"]);
  });

  it("falls back only the failed local attachment and revokes its object URL", async () => {
    useStore.getState().addPendingUserUpload(SESSION_ID, pendingUpload());
    handleMessage(SESSION_ID, committedMessage());

    function StoredMessage() {
      const message = useStore((state) => state.messages.get(SESSION_ID)?.[0]);
      return message ? <MessageBubble message={message} sessionId={SESSION_ID} /> : null;
    }

    render(<StoredMessage />);
    const group = screen.getByTestId("user-image-preview-group");
    const thumbnails = within(group).getAllByTestId("image-preview-thumbnail-image");
    fireEvent.error(thumbnails[0]!);

    const nextImages = within(group).getAllByTestId("image-preview-thumbnail-image");
    expect(nextImages.map((image) => image.getAttribute("src"))).toEqual([
      `/api/images/${SESSION_ID}/image-a/thumb`,
      "blob:local-preview-2",
    ]);
    expect(within(group).getByRole("button", { name: "Loading image first.png" })).toBeDisabled();
    expect(within(group).getByRole("button", { name: "Open image second.jpg" })).toBeEnabled();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-preview-1");
  });

  it("retires only removed attachments, then all previews when the canonical message identity changes", () => {
    useStore.getState().addPendingUserUpload(SESSION_ID, pendingUpload());
    handleMessage(SESSION_ID, committedMessage());

    handleMessage(SESSION_ID, historyWindow(committedMessage({ images: [imageRefs()[0]!] })));
    expect(previewUrls(useStore.getState().messages.get(SESSION_ID))).toEqual(["blob:local-preview-1"]);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-preview-2");

    handleMessage(SESSION_ID, historyWindow(committedMessage({ id: "replacement-message" })));
    expect(useStore.getState().messages.get(SESSION_ID)?.[0]?.localImages).toBeUndefined();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenLastCalledWith("blob:local-preview-1");
  });

  it("revokes active local previews when the browser store resets", () => {
    useStore.getState().addPendingUserUpload(SESSION_ID, pendingUpload());
    handleMessage(SESSION_ID, committedMessage());

    useStore.getState().reset();
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(["blob:local-preview-1", "blob:local-preview-2"]);
  });

  it("revokes every remaining local preview exactly once when its session is removed", () => {
    useStore.getState().addPendingUserUpload(SESSION_ID, pendingUpload());
    handleMessage(SESSION_ID, committedMessage());

    useStore.getState().removeSession(SESSION_ID);
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(["blob:local-preview-1", "blob:local-preview-2"]);

    useStore.getState().reset();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
