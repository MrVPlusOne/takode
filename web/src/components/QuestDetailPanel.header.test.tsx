// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../store.js";
import type { QuestmasterTask, SdkSessionInfo } from "../types.js";
import { QuestDetailPanel } from "./QuestDetailPanel.js";

vi.mock("../api.js", () => ({
  api: {
    questImageUrl: (id: string) => `/api/quests/_images/${id}`,
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
    getSettings: vi.fn().mockResolvedValue({ editorConfig: { editor: "none" } }),
    openVsCodeRemoteFile: vi.fn(),
    getQuestHistory: vi.fn(),
  },
}));

function makeQuest(overrides: Partial<QuestmasterTask> = {}): QuestmasterTask {
  return {
    id: "q-42-v1",
    questId: "q-42",
    version: 1,
    title: "Header labels",
    status: "in_progress",
    description: "Quest view header test.",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    ...overrides,
  } as QuestmasterTask;
}

const workingBoard = new Map([
  ["leader-42", [{ questId: "q-42", status: "WORKING", worker: "worker-42", updatedAt: 1, createdAt: 1 }]],
]);

describe("QuestDetailPanel header", () => {
  beforeEach(() => {
    useStore.setState({ quests: [], questDetails: new Map(), sessionBoards: new Map(), sdkSessions: [] });
  });

  it("shows the same status label as the quest preview: the Journey phase, Done or Cancelled", () => {
    // The quest view used to say "In Progress" while the preview said "Work", and "Done" for a
    // cancelled quest. Both views now share one status label.
    useStore.setState({ quests: [makeQuest()], questOverlayId: "q-42", sessionBoards: workingBoard });
    const view = render(<QuestDetailPanel />);
    expect(screen.getByTestId("quest-detail-status-chip")).toHaveTextContent("Work");
    view.unmount();

    const cancelled = makeQuest({ status: "done", cancelled: true, notes: "Superseded by a broader redesign." });
    useStore.setState({ quests: [cancelled], questOverlayId: "q-42", sessionBoards: new Map() });
    render(<QuestDetailPanel />);
    expect(screen.getByTestId("quest-detail-status-chip")).toHaveTextContent("Cancelled");
    // The note carries the preview's name for it.
    expect(screen.getByTestId("quest-detail-notes")).toHaveTextContent("Cancellation Note");
  });

  it("offers Open Worker and Open Thread for a dispatched quest its worker has not claimed yet", () => {
    // Before the claim the quest has no owner and no recorded leader; the board row supplies both.
    useStore.setState({
      quests: [makeQuest({ status: "refined" })],
      questOverlayId: "q-42",
      sessionBoards: workingBoard,
      sdkSessions: [
        { sessionId: "worker-42", sessionNum: 123, state: "connected", cwd: "/repo", createdAt: 1 },
        {
          sessionId: "leader-42",
          sessionNum: 777,
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          isOrchestrator: true,
        },
      ] as SdkSessionInfo[],
    });
    render(<QuestDetailPanel />);
    expect(screen.getByRole("link", { name: "Open Worker #123" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Thread #777" })).toBeInTheDocument();
  });

  it("pins Open Worker and Open Thread to the bottom on phones and keeps them under the title on desktop", () => {
    // Jumping to the leader thread is the most common move from the quest view, so on a phone the
    // buttons sit in a pinned footer within thumb reach instead of at the top of the dialog.
    useStore.setState({
      quests: [makeQuest()],
      questOverlayId: "q-42",
      sessionBoards: workingBoard,
      sdkSessions: [{ sessionId: "leader-42", sessionNum: 777, state: "connected", cwd: "/repo", createdAt: 1 }],
    });
    const desktopWidth = window.innerWidth;
    try {
      window.innerWidth = 430;
      const phone = render(<QuestDetailPanel />);
      const footer = screen.getByTestId("quest-detail-session-footer");
      expect(footer).toContainElement(screen.getByRole("link", { name: "Open Thread #777" }));
      // The footer follows the scrolling body, so it stays at the bottom however long the quest is.
      expect(screen.getByTestId("quest-detail-scroll-container").nextElementSibling).toBe(footer);
      phone.unmount();

      window.innerWidth = 1280;
      render(<QuestDetailPanel />);
      expect(screen.queryByTestId("quest-detail-session-footer")).toBeNull();
      expect(screen.getByRole("link", { name: "Open Thread #777" })).toBeInTheDocument();
    } finally {
      window.innerWidth = desktopWidth;
    }
  });
});
