// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { QuestDetailPanel } from "./QuestDetailPanel.js";

const mockGetQuestHistory = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    questImageUrl: (id: string) => `/api/quests/_images/${id}`,
    getFsImageUrl: (path: string) => `/api/fs/image?path=${encodeURIComponent(path)}`,
    getSettings: vi.fn().mockResolvedValue({ editorConfig: { editor: "none" } }),
    openVsCodeRemoteFile: vi.fn(),
    getQuestHistory: (...args: unknown[]) => mockGetQuestHistory(...args),
  },
}));

vi.mock("./quest-assign.js", () => ({
  buildQuestAssignDraft: (questId: string) => `Assign draft for ${questId}`,
}));

vi.mock("./quest-rework.js", () => ({
  buildQuestReworkDraft: (questId: string) => `Rework draft for ${questId}`,
}));

function makeQuest(overrides: Partial<QuestmasterTask> = {}): QuestmasterTask {
  return {
    id: "q-42-v1",
    questId: "q-42",
    version: 1,
    title: "Fix modal navigation",
    status: "in_progress",
    description: "Navigate to [worker session](session:123) without hiding the result.",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    sessionId: "worker-42",
    leaderSessionId: "leader-42",
    feedback: [
      {
        author: "agent",
        text: "Agent feedback from [leader session](session:777).",
        ts: 1_700_000_002_000,
        authorSessionId: "leader-42",
      },
    ],
    ...overrides,
  } as QuestmasterTask;
}

function seedSessions() {
  useStore.getState().setSdkSessions([
    {
      sessionId: "worker-42",
      sessionNum: 123,
      state: "connected",
      cwd: "/repo/worker",
      createdAt: 1,
    } as any,
    {
      sessionId: "leader-42",
      sessionNum: 777,
      state: "connected",
      cwd: "/repo/leader",
      createdAt: 1,
      isOrchestrator: true,
    } as any,
  ]);
  useStore.setState({
    sessionNames: new Map([
      ["worker-42", "Worker session"],
      ["leader-42", "Leader session"],
    ]),
    sessionPreviews: new Map([["leader-42", "Latest leader preview from the normal session hover card"]]),
  });
}

describe("QuestDetailPanel navigation dismissal", () => {
  beforeEach(() => {
    useStore.getState().reset();
    mockGetQuestHistory.mockReset();
    seedSessions();
    window.history.replaceState({}, "", "/#/session/123?quest=q-42");
  });

  it("dismisses when the current-session worker header chip navigates", () => {
    useStore.setState({ quests: [makeQuest()], questOverlayId: "q-42" });

    render(<QuestDetailPanel />);

    fireEvent.click(screen.getByRole("link", { name: "#123" }));

    expect(useStore.getState().questOverlayId).toBeNull();
    expect(window.location.hash).toBe("#/session/worker-42");
  });

  it("dismisses and preserves the target quest thread when the current-session leader chip navigates", () => {
    useStore.setState({ quests: [makeQuest()], questOverlayId: "q-42" });
    window.history.replaceState({}, "", "/#/session/777?quest=q-42");

    render(<QuestDetailPanel />);

    fireEvent.click(screen.getByTitle("Open session #777, thread q-42"));

    expect(useStore.getState().questOverlayId).toBeNull();
    expect(window.location.hash).toBe("#/session/777?thread=q-42");
  });

  it("dismisses when an other-session header chip navigates", () => {
    useStore.setState({ quests: [makeQuest()], questOverlayId: "q-42" });
    window.history.replaceState({}, "", "/#/session/other-session?quest=q-42");

    render(<QuestDetailPanel />);

    fireEvent.click(screen.getByRole("link", { name: "#123" }));

    expect(useStore.getState().questOverlayId).toBeNull();
    expect(window.location.hash).toBe("#/session/worker-42");
  });

  it("uses the normal session hover preview for header chips", () => {
    useStore.setState({ quests: [makeQuest()], questOverlayId: "q-42" });

    render(<QuestDetailPanel />);

    fireEvent.mouseEnter(screen.getByTitle("Open session #777, thread q-42"));

    expect(screen.getByText("Latest leader preview from the normal session hover card")).toBeInTheDocument();
  });

  it("dismisses when feedback author and markdown session links navigate", () => {
    useStore.setState({ quests: [makeQuest()], questOverlayId: "q-42" });

    const { rerender } = render(<QuestDetailPanel />);

    const leaderLinks = screen.getAllByRole("link", { name: "#777" });
    expect(leaderLinks).toHaveLength(2);
    const feedbackLeaderLink = leaderLinks[1];
    if (!feedbackLeaderLink) throw new Error("missing feedback leader link");
    fireEvent.click(feedbackLeaderLink);

    expect(useStore.getState().questOverlayId).toBeNull();
    expect(window.location.hash).toBe("#/session/leader-42");

    window.history.replaceState({}, "", "/#/session/123?quest=q-42");
    useStore.setState({ questOverlayId: "q-42" });
    rerender(<QuestDetailPanel />);

    fireEvent.click(screen.getByRole("link", { name: "worker session" }));

    expect(useStore.getState().questOverlayId).toBeNull();
    expect(window.location.hash).toBe("#/session/worker-42");
  });

  it("does not treat Quest Detail markdown quest links as session-dismiss navigation", () => {
    useStore.setState({
      quests: [
        makeQuest({ description: "Keep quest navigation local: [related quest](quest:q-77)." }),
        makeQuest({ id: "q-77-v1", questId: "q-77", title: "Related quest" }),
      ],
      questOverlayId: "q-42",
    });

    render(<QuestDetailPanel />);

    fireEvent.click(screen.getByRole("link", { name: "related quest" }));

    expect(useStore.getState().questOverlayId).toBe("q-77");
  });

  it("dismisses after version-history navigation requests the background message jump", async () => {
    useStore.setState({
      quests: [makeQuest()],
      questOverlayId: "q-42",
      messages: new Map([
        [
          "worker-42",
          [
            {
              id: "quest_claimed-q-42-worker",
              type: "system",
              content: "claimed",
              timestamp: 1_700_000_000_000,
            } as any,
          ],
        ],
      ]),
    });
    mockGetQuestHistory.mockResolvedValue({
      mode: "legacy_backup",
      entries: [
        {
          id: "q-42-v0",
          questId: "q-42",
          version: 0,
          title: "Earlier modal navigation",
          status: "in_progress",
          createdAt: 1_700_000_000_000,
          sessionId: "worker-42",
        },
      ],
    });

    render(<QuestDetailPanel />);

    fireEvent.click(screen.getByText("show history"));
    const historyRow = await screen.findByText("Earlier modal navigation");
    fireEvent.click(historyRow);

    await waitFor(() => {
      expect(useStore.getState().questOverlayId).toBeNull();
    });
    expect(window.location.hash).toBe("#/session/worker-42");
  });

  it("lets version-history markdown session links own navigation before dismissing", async () => {
    useStore.setState({
      quests: [makeQuest()],
      questOverlayId: "q-42",
    });
    mockGetQuestHistory.mockResolvedValue({
      mode: "legacy_backup",
      entries: [
        {
          id: "q-42-v0",
          questId: "q-42",
          version: 0,
          title: "Earlier modal navigation",
          status: "in_progress",
          description: "Review context in the [version leader session](session:777).",
          createdAt: 1_700_000_000_000,
          sessionId: "worker-42",
        },
      ],
    });

    render(<QuestDetailPanel />);

    fireEvent.click(screen.getByText("show history"));
    await screen.findByText("Earlier modal navigation");
    fireEvent.click(screen.getByRole("link", { name: "version leader session" }));

    expect(useStore.getState().questOverlayId).toBeNull();
    expect(window.location.hash).toBe("#/session/leader-42");
  });

  it("keeps version-history markdown quest links local without row dismissal", async () => {
    useStore.setState({
      quests: [makeQuest(), makeQuest({ id: "q-77-v1", questId: "q-77", title: "Related quest" })],
      questOverlayId: "q-42",
    });
    mockGetQuestHistory.mockResolvedValue({
      mode: "legacy_backup",
      entries: [
        {
          id: "q-42-v0",
          questId: "q-42",
          version: 0,
          title: "Earlier modal navigation",
          status: "in_progress",
          description: "Keep the [related quest](quest:q-77) open.",
          createdAt: 1_700_000_000_000,
          sessionId: "worker-42",
        },
      ],
    });

    render(<QuestDetailPanel />);

    fireEvent.click(screen.getByText("show history"));
    await screen.findByText("Earlier modal navigation");
    fireEvent.click(screen.getByRole("link", { name: "related quest" }));

    expect(useStore.getState().questOverlayId).toBe("q-77");
    expect(window.location.hash).toBe("#/session/123?quest=q-42");
  });
});
