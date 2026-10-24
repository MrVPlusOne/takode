// @vitest-environment jsdom

// The quest thread behind a chat-feed quest link: the preview's Open Worker and Open Thread
// buttons, and the icon after the link, which goes straight to the quest's leader thread.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { api } from "../api.js";
import { useStore } from "../store.js";
import {
  quest,
  hoverThreadIcon,
  renderFeedLink,
  setUpQuestFeedLinkTest,
  tearDownQuestFeedLinkTest,
} from "../test-fixtures/quest-feed-inline-link.js";
import { QuestFeedInlineLink } from "./QuestFeedInlineLink.js";

vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn(),
  },
}));

const mockGetQuestValidated = vi.mocked(api.getQuestValidated);

describe("QuestInlineLink chat-feed quest thread", () => {
  beforeEach(setUpQuestFeedLinkTest);
  afterEach(tearDownQuestFeedLinkTest);

  it("puts Open Worker and Open Thread at the top, ahead of the exact feedback actions", async () => {
    // The user reviews quests from this preview and most often wants the quest's leader thread, so
    // both jump buttons sit directly under the title instead of in the footer or participant list.
    const cached = quest({
      questId: "q-490",
      title: "Leader thread jump",
      sessionId: "worker-490",
      claimedAt: 2,
      leaderSessionId: "leader-490",
      feedback: [
        {
          author: "human",
          text: "Keep the exact feedback action primary.",
          ts: 1,
        },
      ],
    });
    useStore.setState({
      questDetails: new Map([["q-490", cached]]),
      questDetailEtags: new Map([["q-490", '"leader-route"']]),
      sdkSessions: [
        {
          sessionId: "worker-490",
          sessionNum: 6490,
          archived: false,
          state: "running",
          cwd: "/tmp/worker-490",
          createdAt: 1,
        },
        {
          sessionId: "leader-490",
          sessionNum: 7490,
          archived: false,
          isOrchestrator: true,
          state: "running",
          cwd: "/tmp/leader-490",
          createdAt: 1,
        },
      ],
    });
    mockGetQuestValidated.mockResolvedValueOnce({
      status: "not-modified",
      etag: '"leader-route"',
    });
    renderFeedLink("q-490", { feedbackIndex: 0 });

    hoverThreadIcon("q-490");
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Leader thread jump" });
    const primary = within(dialog).getByTestId("quest-feed-primary-action");
    const worker = within(dialog).getByRole("link", {
      name: "Open Worker #6490",
    });
    const thread = within(dialog).getByRole("link", {
      name: "Open Thread #7490",
    });
    const parent = within(dialog).getByTestId("quest-feed-parent-action");
    expect(primary).toHaveTextContent("Open feedback #0");
    expect(worker).toHaveAttribute("href", "#/session/6490");
    expect(thread).toHaveAttribute("href", "#/session/7490?thread=q-490");
    // The jump buttons sit right under the status line and title, ahead of the summaries and the
    // footer's exact-feedback parent action.
    const statusRow = within(dialog).getByTestId("quest-hover-status-row");
    expect(statusRow.compareDocumentPosition(worker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(worker.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(thread.compareDocumentPosition(parent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The buttons are the only place the worker (here the owner session) and the leader appear.
    expect(within(dialog).queryByTestId("quest-hover-owner-session")).toBeNull();
    expect(within(dialog).queryByTestId("quest-hover-leader-session")).toBeNull();

    fireEvent.click(thread);
    expect(window.location.hash).toBe("#/session/7490?thread=q-490");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the recorded leader's quest thread without needing that leader's board or tabs loaded", async () => {
    // Quest views opened outside the leader session have no copy of its board or tab projection.
    // The leader session itself decides on arrival whether the thread exists (falling back to Main).
    const cached = quest({
      questId: "q-493",
      title: "Unloaded leader route",
      leaderSessionId: "leader-493",
    });
    useStore.setState({
      questDetails: new Map([["q-493", cached]]),
      questDetailEtags: new Map([["q-493", '"unloaded-route"']]),
      sdkSessions: [
        {
          sessionId: "leader-493",
          sessionNum: 7493,
          archived: false,
          isOrchestrator: true,
          state: "running",
          cwd: "/tmp/leader-493",
          createdAt: 1,
        },
      ],
    });
    mockGetQuestValidated.mockResolvedValueOnce({
      status: "not-modified",
      etag: '"unloaded-route"',
    });
    renderFeedLink("q-493");

    hoverThreadIcon("q-493");
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", {
      name: "Unloaded leader route",
    });
    expect(within(dialog).getByRole("link", { name: "Open Thread #7493" })).toHaveAttribute(
      "href",
      "#/session/7493?thread=q-493",
    );
  });

  it("uses the worker's leader for Open Thread when the quest recorded no leader", async () => {
    const cached = quest({
      questId: "q-491",
      title: "Herded worker leader fallback",
      sessionId: "worker-491",
      claimedAt: 2,
    });
    useStore.setState({
      questDetails: new Map([["q-491", cached]]),
      questDetailEtags: new Map([["q-491", '"herded-route"']]),
      sdkSessions: [
        {
          sessionId: "worker-491",
          archived: false,
          herdedBy: "leader-491",
          state: "running",
          cwd: "/tmp/worker-491",
          createdAt: 1,
        },
        {
          sessionId: "leader-491",
          sessionNum: 7491,
          archived: false,
          isOrchestrator: true,
          state: "running",
          cwd: "/tmp/leader-491",
          createdAt: 1,
        },
      ],
    });
    mockGetQuestValidated.mockResolvedValueOnce({
      status: "not-modified",
      etag: '"herded-route"',
    });
    renderFeedLink("q-491");

    hoverThreadIcon("q-491");
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", {
      name: "Herded worker leader fallback",
    });
    expect(within(dialog).queryByTestId("quest-hover-leader-session")).toBeNull();
    expect(within(dialog).getByRole("link", { name: "Open Thread #7491" })).toHaveAttribute(
      "href",
      "#/session/7491?thread=q-491",
    );
  });

  it("offers Open Thread for a dispatched quest its worker has not claimed yet", async () => {
    // Reproduces the "No leader session for this quest" report: right after dispatch the quest has
    // no owner and no recorded leader (both arrive with the worker's claim), but the leader's board
    // already holds the row with its worker.
    const cached = quest({ questId: "q-495", title: "Freshly dispatched quest", status: "refined" });
    useStore.setState({
      questDetails: new Map([["q-495", cached]]),
      questDetailEtags: new Map([["q-495", '"dispatched"']]),
      sessionBoards: new Map([
        [
          "leader-495",
          [{ questId: "q-495", status: "WORKING", worker: "worker-495", workerNum: 7496, updatedAt: 1, createdAt: 1 }],
        ],
      ]),
      sdkSessions: [
        {
          sessionId: "leader-495",
          sessionNum: 7495,
          archived: false,
          isOrchestrator: true,
          state: "running",
          cwd: "/tmp/leader-495",
          createdAt: 1,
        },
      ],
    });
    mockGetQuestValidated.mockResolvedValueOnce({ status: "not-modified", etag: '"dispatched"' });
    renderFeedLink("q-495");

    hoverThreadIcon("q-495");
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Freshly dispatched quest" });
    expect(within(dialog).getByRole("link", { name: "Open Thread #7495" })).toHaveAttribute(
      "href",
      "#/session/7495?thread=q-495",
    );
    expect(within(dialog).getByTestId("quest-open-worker")).not.toBeDisabled();
  });

  it("keeps a disabled Open Worker in place when the quest has only a leader", async () => {
    // Both buttons always share the same spot, so a missing session disables its button instead of
    // shifting the other one.
    const cached = quest({
      questId: "q-492",
      title: "Leader-only quest",
      leaderSessionId: "leader-492",
    });
    useStore.setState({
      questDetails: new Map([["q-492", cached]]),
      questDetailEtags: new Map([["q-492", '"leader-only"']]),
      sdkSessions: [
        {
          sessionId: "leader-492",
          sessionNum: 7492,
          archived: false,
          isOrchestrator: true,
          state: "running",
          cwd: "/tmp/leader-492",
          createdAt: 1,
        },
      ],
    });
    mockGetQuestValidated.mockResolvedValueOnce({
      status: "not-modified",
      etag: '"leader-only"',
    });
    renderFeedLink("q-492");

    hoverThreadIcon("q-492");
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "Leader-only quest" });
    const worker = within(dialog).getByTestId("quest-open-worker");
    expect(worker).toBeDisabled();
    expect(worker).toHaveTextContent("Open Worker");
    expect(within(dialog).getByTestId("quest-open-thread")).toHaveAttribute("href", "#/session/7492?thread=q-492");
  });

  it("omits the session buttons for a quest with no worker or leader", async () => {
    const cached = quest({ questId: "q-494", title: "Unassigned quest" });
    useStore.setState({
      questDetails: new Map([["q-494", cached]]),
      questDetailEtags: new Map([["q-494", '"unassigned"']]),
    });
    mockGetQuestValidated.mockResolvedValueOnce({
      status: "not-modified",
      etag: '"unassigned"',
    });
    renderFeedLink("q-494");

    fireEvent.click(screen.getByRole("button", { name: /Preview q-494/ }));
    await act(async () => Promise.resolve());

    expect(
      within(screen.getByRole("dialog", { name: "Unassigned quest" })).queryByTestId("quest-session-actions"),
    ).toBeNull();
  });

  it("goes straight to the quest's thread when the icon after the link is clicked", async () => {
    // The icon after a quest link is a jump to the quest's leader thread, like the preview's Open
    // Thread; the user goes there more often than to the quest itself. Hovering still previews.
    const cached = quest({ questId: "q-496", title: "Jump target", leaderSessionId: "leader-496" });
    const onNavigate = vi.fn();
    const onSessionNavigate = vi.fn();
    useStore.setState({
      questDetails: new Map([["q-496", cached]]),
      sdkSessions: [
        {
          sessionId: "leader-496",
          sessionNum: 7496,
          archived: false,
          isOrchestrator: true,
          state: "running",
          cwd: "/tmp/leader-496",
          createdAt: 1,
        },
      ],
    });
    render(
      <QuestFeedInlineLink
        questId="q-496"
        className="cc-quest-link"
        stopPropagation={false}
        onNavigate={onNavigate}
        onSessionNavigate={onSessionNavigate}
      />,
    );

    const icon = screen.getByRole("button", { name: "Open the q-496 thread: Jump target" });
    // It no longer opens a dialog when clicked, so it does not announce one.
    expect(icon).not.toHaveAttribute("aria-haspopup");
    fireEvent.click(icon);

    expect(window.location.hash).toBe("#/session/7496?thread=q-496");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    // A covering view (guided review, file viewer) closes so the thread is visible.
    expect(onSessionNavigate).toHaveBeenCalledTimes(1);
  });

  it("jumps from a hover preview and from a phone tap, where the icon is the way to the thread", async () => {
    // Hovering the icon first opens the preview; clicking the icon then still jumps rather than
    // pinning the preview. On a phone the tap goes to the thread too, while a tap on the link text
    // keeps opening the preview sheet.
    const cached = quest({ questId: "q-497", title: "Touch jump target", leaderSessionId: "leader-497" });
    useStore.setState({ questDetails: new Map([["q-497", cached]]) });
    mockGetQuestValidated.mockResolvedValue({ status: "not-modified", etag: '"touch-jump"' });
    renderFeedLink("q-497");

    hoverThreadIcon("q-497");
    await act(async () => Promise.resolve());
    expect(screen.getByRole("dialog", { name: "Touch jump target" })).toHaveAttribute("data-open-mode", "hover");
    fireEvent.click(screen.getByRole("button", { name: /^Open the q-497 thread/ }));
    // An unlisted leader has no number yet, so the route names it by ID.
    expect(window.location.hash).toBe("#/session/leader-497?thread=q-497");
    expect(screen.queryByRole("dialog")).toBeNull();

    // Back outside the thread (inside it the icon would preview instead).
    act(() => {
      window.location.hash = "#/session/s1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    const icon = screen.getByRole("button", { name: /^Open the q-497 thread/ });
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    fireEvent.click(icon, { detail: 1 });
    expect(window.location.hash).toBe("#/session/leader-497?thread=q-497");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("finds the thread of a quest whose record is not loaded from the leader's board", () => {
    // A leader's own quest links often point at its active board rows before any quest record is
    // fetched; the board already names the leader, so the jump needs no round trip.
    useStore.setState({
      sessionBoards: new Map([["leader-498", [{ questId: "q-498", status: "WORKING", updatedAt: 1, createdAt: 1 }]]]),
      sdkSessions: [
        {
          sessionId: "leader-498",
          sessionNum: 7498,
          archived: false,
          isOrchestrator: true,
          state: "running",
          cwd: "/tmp/leader-498",
          createdAt: 1,
        },
      ],
    });
    renderFeedLink("q-498");

    fireEvent.click(screen.getByRole("button", { name: "Open the q-498 thread" }));
    expect(window.location.hash).toBe("#/session/7498?thread=q-498");
    expect(mockGetQuestValidated).not.toHaveBeenCalled();
  });

  it("previews instead of jumping when the link is already inside the quest's thread", async () => {
    // A quest thread mentions its own quest; going "to" the thread on screen would do nothing.
    const cached = quest({ questId: "q-489", title: "Own thread", leaderSessionId: "leader-489" });
    useStore.setState({ questDetails: new Map([["q-489", cached]]) });
    mockGetQuestValidated.mockResolvedValue({ status: "not-modified", etag: '"own-thread"' });
    window.location.hash = "#/session/leader-489?thread=q-489";
    renderFeedLink("q-489");

    fireEvent.click(screen.getByRole("button", { name: "Preview q-489: Own thread" }));
    await act(async () => Promise.resolve());

    expect(screen.getByRole("dialog", { name: "Own thread" })).toHaveAttribute("data-open-mode", "explicit");
    expect(window.location.hash).toBe("#/session/leader-489?thread=q-489");
  });

  it("opens the preview instead when the quest has no thread to go to", async () => {
    // Fallback: with no leader known, the icon keeps its old preview role (and label), and the
    // preview's Open quest goes on to the quest.
    renderFeedLink("q-499", { title: "No thread yet" });
    const icon = screen.getByRole("button", { name: "Preview q-499: No thread yet" });
    expect(icon).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.click(icon);
    await act(async () => Promise.resolve());

    const dialog = screen.getByRole("dialog", { name: "No thread yet" });
    expect(dialog).toHaveAttribute("data-open-mode", "explicit");
    expect(within(dialog).getByTestId("quest-feed-primary-action")).toHaveTextContent("Open quest");
    expect(window.location.hash).toBe("#/session/s1");
  });
});
