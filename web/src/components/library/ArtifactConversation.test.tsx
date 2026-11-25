// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Quest titles name where a thread started from; none are needed here.
vi.mock("../../api.js", () => ({ api: { getQuestTitles: async () => ({ quests: [], missingQuestIds: [] }) } }));
vi.mock("../../ws.js", () => ({ holdSessionConnection: () => () => {}, sendToSession: () => true }));
// A selection on the artifact's text, as the selection hook reports it.
const selected = vi.hoisted(() => ({ text: "" }));
vi.mock("../../hooks/useTextSelection.js", () => ({
  useTextSelection: () => ({
    isActive: !!selected.text,
    plainText: selected.text,
    range: null,
    position: { x: 10, y: 10 },
    clear: () => {},
    dismiss: () => {},
  }),
}));
// The message boxes and the thread's feed are tested where they live; here they show what they got.
vi.mock("../Composer.js", () => ({
  Composer: ({
    draftKey,
    threadKey,
    newThread,
  }: {
    draftKey: string;
    threadKey: string;
    newThread?: { start: (text: string) => Promise<string | null> };
  }) => (
    <div data-testid="composer" data-draft-key={draftKey} data-thread-key={threadKey}>
      {newThread && (
        <button type="button" onClick={() => void newThread.start("Why 7 traps?")}>
          Send
        </button>
      )}
    </div>
  ),
}));
vi.mock("../side-column/SideSession.js", () => ({
  SideSession: ({ sessionId }: { sessionId: string }) => <div data-testid="side-session" data-session-id={sessionId} />,
}));
vi.mock("../side-column/SideConversation.js", () => ({
  SideConversation: ({ threadKey }: { threadKey: string }) => (
    <div data-testid="side-conversation" data-thread-key={threadKey} />
  ),
}));

import type { ArtifactDetail } from "../../../shared/artifact-library.js";
import { sideComposerDraftKey } from "../../draft-sync-bridge.js";
import { useStore } from "../../store.js";
import type { SdkSessionInfo } from "../../types.js";
import { ArtifactViewer } from "./ArtifactViewer.js";

/**
 * An artifact's side chat in its own views (the Library, the side column, its own window): a
 * button opens it, the first comment on its text opens it too. With the leader the version came
 * from it is a thread created only by the first message sent there; with a worker it is the
 * worker's own conversation; a session that is archived takes no comments.
 */

const NOW = Date.now();
const SOURCE = { sessionId: "leader-1", messageId: "m1", threadKey: "q-2925", at: NOW };
const DETAIL: ArtifactDetail = {
  id: "a1",
  kind: "report",
  title: "The Rocq proof eval, explained",
  space: "MSI",
  sessionId: "leader-1",
  threadKey: "q-2925",
  createdAt: NOW,
  updatedAt: NOW,
  starred: false,
  versionCount: 1,
  latest: { n: 1, at: NOW, bytes: 10, kept: true, source: SOURCE },
  preview: "",
  versions: [{ n: 1, at: NOW, bytes: 10, kept: true, source: SOURCE }],
};

/** Lists the session the artifact came from, as the session list reports it. */
function listSource(fields: Partial<SdkSessionInfo>) {
  const session = { sessionId: "leader-1", sessionNum: 7, name: "Eval worker", ...fields } as SdkSessionInfo;
  useStore.getState().setSdkSessions([session]);
}

let threads: unknown[];
let started: Array<Record<string, unknown>>;

beforeEach(() => {
  listSource({ isOrchestrator: true });
  selected.text = "";
  threads = [];
  started = [];
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/artifacts/a1") return new Response(JSON.stringify(DETAIL));
      if (url.startsWith("/api/artifacts/a1/versions/")) {
        return new Response(JSON.stringify({ kind: "report", markdown: "The model must prove those in Rocq." }));
      }
      if (url === "/api/topics/threads" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        started.push(body);
        const thread = { id: "t1", key: "topic:t1", name: body.name, leaderId: "leader-1", artifact: body.artifact };
        return new Response(JSON.stringify({ thread: { ...thread, createdAt: NOW, activityAt: NOW } }));
      }
      if (url.startsWith("/api/topics/threads")) return new Response(JSON.stringify({ threads }));
      return new Response(JSON.stringify({ topics: [], map: {} }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.getState().setAnnotationEditor(null);
  useStore.getState().setSdkSessions([]);
});

describe("an artifact's side chat", () => {
  it("opens empty from its button and starts the thread only when a first message is sent", async () => {
    render(<ArtifactViewer id="a1" />);
    const button = await screen.findByRole("button", { name: "Ask about this report" });
    expect(screen.queryByTestId("artifact-side-chat")).toBeNull();

    fireEvent.click(button);
    // An empty side chat: a message box, from the quest the report was shown in, and no thread yet.
    const composer = await screen.findByTestId("composer");
    expect(composer).toHaveAttribute("data-draft-key", sideComposerDraftKey("leader-1", "artifact:a1"));
    expect(composer).toHaveAttribute("data-thread-key", "q-2925");
    expect(started).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      leader: "leader-1",
      startedFrom: "q-2925",
      artifact: { id: "a1", title: "The Rocq proof eval, explained" },
    });
    // Once started, the chat is that thread's conversation.
    expect(await screen.findByTestId("side-conversation")).toHaveAttribute("data-thread-key", "topic:t1");
  });

  it("opens the side chat with the comment's editor when a passage is commented on", async () => {
    selected.text = "must prove those";
    render(<ArtifactViewer id="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    // There is no "Ask in new thread": the side chat is this artifact's thread already.
    expect(screen.queryByRole("button", { name: "Ask in new thread" })).toBeNull();
    await screen.findByTestId("artifact-side-chat");
    await waitFor(() => expect(useStore.getState().annotationEditor).not.toBeNull());
    expect(useStore.getState().annotationEditor).toMatchObject({
      sessionId: "leader-1",
      draftKey: sideComposerDraftKey("leader-1", "artifact:a1"),
      annotation: { selectedText: "must prove those" },
    });
  });

  it("shows the existing thread about the artifact when there is one", async () => {
    threads = [{ id: "t9", key: "topic:t9", name: "x", leaderId: "leader-1", artifact: { id: "a1", title: "x" } }];
    render(<ArtifactViewer id="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask about this report" }));
    expect(await screen.findByTestId("side-conversation")).toHaveAttribute("data-thread-key", "topic:t9");
  });

  // The chat must not squeeze the artifact (a deck would lose its 16:9 stage): it sits beside it
  // when both fit at the artifact's own width, pops over its right side when not, and goes under it
  // on a phone or in a narrow column. The page grows by the open chat's width (440 by default).
  it.each([
    { width: 1464, placement: "beside" },
    { width: 1100, placement: "over" },
    { width: 600, placement: "under" },
  ])("places the side chat $placement the artifact in a $width pixel view", async ({ width, placement }) => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.testid === "artifact-conversation" ? width : 0;
    });
    try {
      render(<ArtifactViewer id="a1" />);
      const viewer = await screen.findByTestId("artifact-viewer");
      fireEvent.click(await screen.findByRole("button", { name: "Ask about this report" }));
      expect(await screen.findByTestId("artifact-side-chat")).toHaveAttribute("data-placement", placement);
      expect(viewer.style.getPropertyValue("--artifact-chat-w")).toBe("440px");

      // Closed, the page is back to the artifact's own width.
      fireEvent.click(screen.getAllByRole("button", { name: "Close the side chat" })[0]);
      await waitFor(() => expect(screen.queryByTestId("artifact-side-chat")).toBeNull());
      expect(viewer.style.getPropertyValue("--artifact-chat-w")).toBe("0px");
    } finally {
      clientWidth.mockRestore();
    }
  });

  // A worker's report opened on its own (Lingxiao, Nov 25): it used to offer no Comment at all.
  // Its comments go to the worker's own message box, as they do in the worker's conversation.
  it("comments on a worker's artifact in the worker's own conversation", async () => {
    listSource({ isOrchestrator: false });
    selected.text = "must prove those";
    render(<ArtifactViewer id="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
    expect(await screen.findByTestId("side-session")).toHaveAttribute("data-session-id", "leader-1");
    expect(screen.getByText("Chat with #7 Eval worker")).toBeInTheDocument();
    await waitFor(() => expect(useStore.getState().annotationEditor).not.toBeNull());
    expect(useStore.getState().annotationEditor).toMatchObject({
      sessionId: "leader-1",
      draftKey: "leader-1",
      annotation: { selectedText: "must prove those" },
    });
  });

  it("says why an artifact from an archived session takes no comments", async () => {
    listSource({ isOrchestrator: true, archived: true });
    selected.text = "must prove those";
    render(<ArtifactViewer id="a1" />);
    expect(await screen.findByTestId("artifact-comments-off")).toHaveTextContent("archived");
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask about this report" })).toBeNull();
  });

  // Before the session list arrives (an artifact window just opened) nothing is known yet, so
  // there is no note that might be wrong a moment later.
  it("shows no note before the session list has loaded", async () => {
    useStore.getState().setSdkSessions([]);
    render(<ArtifactViewer id="a1" />);
    await screen.findByText("The model must prove those in Rocq.");
    expect(screen.queryByTestId("artifact-comments-off")).toBeNull();
  });
});
