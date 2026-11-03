// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { SOURCE_OPEN_TIMEOUT_MS, useAnnotationSourceNavigation } from "./use-annotation-source-navigation.js";
import { SecondaryFeedContext } from "./secondary-feed.js";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), navigate: vi.fn() }));
vi.mock("../api/session-message-search.js", async (original) => ({
  ...(await original<typeof import("../api/session-message-search.js")>()),
  resolveSessionMessageTarget: mocks.resolve,
}));
vi.mock("../utils/routing.js", async (original) => ({
  ...(await original<typeof import("../utils/routing.js")>()),
  navigateToSessionMessageId: (...args: unknown[]) => mocks.navigate(...args),
}));
const annotation = {
  id: "comment",
  sourceMessageId: "source",
  selectedText: "Repeated words",
  comment: "A saved comment",
};
function Harness({ loaded = true, thread = "main" }: { loaded?: boolean; thread?: string }) {
  const open = useAnnotationSourceNavigation("session", thread);
  return (
    <div data-feed-session-id="session" data-feed-thread-key={thread}>
      {loaded && (
        <div data-message-id="source">
          <p data-chat-selection-scope="true">Repeated words</p>
        </div>
      )}
      <button onClick={() => void open(annotation)}>Open comment</button>
    </div>
  );
}
beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.navigate.mockReset();
  useStore.setState({
    annotationEditor: null,
    annotationHover: null,
    scrollToMessageId: new Map(),
    scrollToMessageFeed: new Map(),
    expandAllInTurn: new Map(),
    composerDrafts: new Map([["session", { text: "Draft", images: [], annotations: [annotation] }]]),
  });
});
afterEach(cleanup);
it("uses bounded-feed navigation before opening beside an already mounted source", () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Open comment"));
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(useStore.getState().scrollToMessageId.get("session")).toBe("source");
  expect(useStore.getState().annotationEditor?.navigateToSource).toBe(true);
  // MessageFeed clears this only after its target request/scroll finishes.
  act(() => useStore.getState().clearScrollToMessage("session"));
  expect(useStore.getState().annotationEditor).toMatchObject({
    annotation,
    navigateToSource: false,
    sourceUnavailable: false,
  });
});
it("uses the server-owned thread for a source outside the loaded window", async () => {
  mocks.resolve.mockResolvedValue({ messageId: "source", threadKey: "other" });
  mocks.navigate.mockImplementation(() => useStore.getState().requestScrollToMessage("session", "source"));
  const view = render(<Harness loaded={false} />);
  fireEvent.click(screen.getByText("Open comment"));
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith("session", "source", {
      threadKey: "other",
      preserveMainThreadRoute: true,
    }),
  );
  expect(useStore.getState().annotationEditor?.threadKey).toBe("other");
  view.rerender(<Harness loaded thread="other" />);
  act(() => useStore.getState().clearScrollToMessage("session"));
  expect(useStore.getState().annotationEditor?.navigateToSource).toBe(false);
});
it("keeps the comment editable when the source is unavailable", async () => {
  mocks.resolve.mockResolvedValue(null);
  render(<Harness loaded={false} />);
  fireEvent.click(screen.getByText("Open comment"));
  await waitFor(() => expect(useStore.getState().annotationEditor?.sourceUnavailable).toBe(true));
  expect(mocks.navigate).not.toHaveBeenCalled();
});
it.each(["navigation", "removal"])("ignores a late source lookup after %s", async (action) => {
  let complete!: (value: { messageId: string; threadKey: string }) => void;
  mocks.resolve.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(<Harness loaded={false} />);
  fireEvent.click(screen.getByText("Open comment"));
  if (action === "navigation") view.rerender(<Harness loaded={false} thread="other" />);
  else act(() => useStore.getState().clearComposerDraft("session"));
  await act(async () => complete({ messageId: "source", threadKey: "main" }));
  expect(useStore.getState().annotationEditor).toBeNull();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

/** A side pane (feed key "pane") with its composer's chips, beside a main feed showing the same thread. */
function SidePane({
  mainHasSource = true,
  paneHasSource = true,
}: {
  mainHasSource?: boolean;
  paneHasSource?: boolean;
}) {
  return (
    <>
      <div data-feed-session-id="session" data-feed-thread-key="q-1">
        {mainHasSource && <div data-message-id="source">Repeated words</div>}
      </div>
      <SecondaryFeedContext.Provider value="pane">
        <PaneComposer paneHasSource={paneHasSource} />
      </SecondaryFeedContext.Provider>
    </>
  );
}
function PaneComposer({ paneHasSource }: { paneHasSource: boolean }) {
  const open = useAnnotationSourceNavigation("session", "q-1", "pane-draft");
  return (
    <div data-feed-session-id="session" data-feed-thread-key="q-1" data-feed-key="pane">
      {paneHasSource && (
        <div data-message-id="source">
          <p data-chat-selection-scope="true">Repeated words</p>
        </div>
      )}
      <button onClick={() => void open(annotation)}>Open comment</button>
    </div>
  );
}
function paneDraft() {
  useStore.setState({
    composerDrafts: new Map([["pane-draft", { text: "Draft", images: [], annotations: [annotation] }]]),
  });
}

it("jumps a side pane's own feed to a comment its chip names, even when the main view shows the thread too", () => {
  // Jiayi (Nov 2): a side pane's comment chip said "Opening comment at its source…" and did nothing.
  // The jump went to the main feed, which never landed it, so the comment never opened.
  paneDraft();
  render(<SidePane />);
  fireEvent.click(screen.getByText("Open comment"));
  expect(useStore.getState().scrollToMessageId.get("session")).toBe("source");
  expect(useStore.getState().scrollToMessageFeed.get("session")).toBe("pane");
  expect(useStore.getState().annotationEditor).toMatchObject({ draftKey: "pane-draft", threadKey: "q-1" });
  expect(useStore.getState().annotationEditor?.source).toBeUndefined();
  act(() => useStore.getState().clearScrollToMessage("session"));
  expect(useStore.getState().annotationEditor).toMatchObject({ navigateToSource: false, sourceUnavailable: false });
});

it("loads a side pane's own thread for a source outside its window, without moving the main view", async () => {
  paneDraft();
  mocks.resolve.mockResolvedValue({ messageId: "source", threadKey: "q-1" });
  render(<SidePane mainHasSource={false} paneHasSource={false} />);
  fireEvent.click(screen.getByText("Open comment"));
  await waitFor(() => expect(useStore.getState().scrollToMessageFeed.get("session")).toBe("pane"));
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(useStore.getState().annotationEditor).toMatchObject({ threadKey: "q-1", navigateToSource: true });
});

it("opens a side pane's comment from another thread in the main view, keeping the editor in the pane", async () => {
  paneDraft();
  mocks.resolve.mockResolvedValue({ messageId: "source", threadKey: "q-2" });
  render(<SidePane mainHasSource={false} paneHasSource={false} />);
  fireEvent.click(screen.getByText("Open comment"));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  // The editor stays this pane's composer's, so it shows there and nothing hidden holds back Send.
  expect(useStore.getState().annotationEditor).toMatchObject({
    draftKey: "pane-draft",
    threadKey: "q-1",
    source: { feedKey: null, threadKey: "q-2" },
  });
});

it("opens the editor anyway when the jump never lands", () => {
  // A jump that never finishes must not leave the comment opening forever, holding back Send.
  vi.useFakeTimers();
  try {
    paneDraft();
    render(<SidePane />);
    fireEvent.click(screen.getByText("Open comment"));
    expect(useStore.getState().annotationEditor?.navigateToSource).toBe(true);
    act(() => vi.advanceTimersByTime(SOURCE_OPEN_TIMEOUT_MS));
    expect(useStore.getState().annotationEditor).toMatchObject({ navigateToSource: false, draftKey: "pane-draft" });
  } finally {
    vi.useRealTimers();
  }
});
