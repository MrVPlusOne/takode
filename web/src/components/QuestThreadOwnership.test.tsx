// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadTabsProjectionValue } from "../../shared/leader-thread-tabs-projection.js";
import { useStore } from "../store.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { mergeProjectedLeaderThreadRows } from "../utils/leader-thread-tabs-navigation.js";
import { QuestThreadBanner } from "./QuestThreadBanner.js";
import { WorkBoardBar } from "./WorkBoardBar.js";

/**
 * A leader keeps a tab for every quest it has a thread for, including quests it
 * handed to another leader. These tests check that such tabs, and the quest
 * header, say who runs the quest instead of looking like this leader's active
 * work, while the leader's own quests render as before.
 */

vi.mock("../ws.js", () => ({ sendToSession: vi.fn(() => true) }));
vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: vi.fn().mockResolvedValue({ status: "missing", data: null, etag: null }),
    markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
    markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

const WORK_JOURNEY = {
  mode: "active" as const,
  phaseIds: ["work", "memory"] as const,
  currentPhaseId: "work",
  activePhaseIndex: 0,
  phaseCount: 2,
  durationSummary: null,
};

// Producer-shaped tabs: what the server projects for a leader whose tabs mix its own
// work, a quest handed to leader #2851, and quests no leader's board holds.
function ownershipProjection(): LeaderThreadTabsProjectionValue {
  return createLeaderThreadTabsProjectionValue({
    tabs: [
      createLeaderThreadTabsProjectionTab("q-1", {
        title: "Own active quest",
        boardStatus: "WORKING",
        journey: { ...WORK_JOURNEY, phaseIds: [...WORK_JOURNEY.phaseIds] },
        sourceLeaderSessionId: "leader",
        ownership: "own",
        active: true,
        canClose: false,
      }),
      createLeaderThreadTabsProjectionTab("q-2", {
        title: "Handed to another leader",
        boardStatus: "WORKING",
        journey: { ...WORK_JOURNEY, phaseIds: [...WORK_JOURNEY.phaseIds] },
        sourceLeaderSessionId: "leader-devbox",
        workerSessionId: "worker-devbox",
        workerSessionNum: 2914,
        ownership: "other-leader",
      }),
      createLeaderThreadTabsProjectionTab("q-3", {
        title: "Removed from the board",
        ownership: "off-board",
      }),
      createLeaderThreadTabsProjectionTab("q-4", {
        title: "Finished off the board",
        boardStatus: "DONE",
        ownership: "off-board",
        completed: true,
      }),
      // No board row says so, but Questmaster's loaded record shows this one finished.
      createLeaderThreadTabsProjectionTab("q-5", {
        title: "Finished and removed",
        ownership: "off-board",
      }),
    ],
  });
}

function installLeader(value: LeaderThreadTabsProjectionValue): void {
  useStore.setState({
    sdkSessions: [
      {
        sessionId: "leader",
        sessionNum: 2763,
        archived: false,
        isOrchestrator: true,
      } as never,
      {
        sessionId: "leader-devbox",
        sessionNum: 2851,
        archived: false,
        isOrchestrator: true,
      } as never,
    ],
    sessions: new Map([
      [
        "leader",
        {
          session_id: "leader",
          model: "test",
          cwd: "/repo",
          isOrchestrator: true,
        } as never,
      ],
    ]),
    quests: [
      {
        id: "q-5",
        questId: "q-5",
        title: "Finished and removed",
        status: "done",
      } as never,
    ],
  });
  useStore.getState().applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope({ key: "leader", value }));
}

function bannerRow(threadKey: string) {
  return mergeProjectedLeaderThreadRows([], ownershipProjection(), new Map()).find(
    (row) => row.threadKey === threadKey,
  )!;
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  useStore.getState().reset();
});

describe("quest tabs led by another leader", () => {
  it("mutes and labels tabs this leader does not run while its own tabs stay unchanged", () => {
    installLeader(ownershipProjection());
    render(<WorkBoardBar sessionId="leader" currentThreadKey="main" onCloseThreadTab={() => {}} />);

    const tab = (threadKey: string) =>
      screen.getAllByTestId("thread-tab").find((candidate) => candidate.dataset.threadKey === threadKey)!;

    // Own active work keeps its phase color, no ownership note and no close button.
    const own = tab("q-1");
    expect(own).toHaveAttribute("data-ownership-note", "");
    expect(within(own).getByTestId("thread-tab-title").dataset.titleColor).not.toBe("var(--color-cc-muted)");
    expect(within(own).queryByTestId("thread-tab-led-elsewhere-icon")).toBeNull();
    expect(own).toHaveAttribute("data-closable", "false");

    // A handed-off quest is muted, names the leader that runs it and can be closed.
    const handed = tab("q-2");
    expect(handed).toHaveAttribute("data-ownership-note", "Led by #2851");
    expect(within(handed).getByTestId("thread-tab-title")).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
    expect(within(handed).getByTestId("thread-tab-led-elsewhere-icon")).toBeInTheDocument();
    expect(handed).toHaveAttribute("data-closable", "true");

    // An unfinished quest no board holds is muted and says so; a finished one only reads as done.
    const removed = tab("q-3");
    expect(removed).toHaveAttribute("data-ownership-note", "Not on board");
    expect(within(removed).getByTestId("thread-tab-title")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-muted)",
    );
    expect(within(removed).queryByTestId("thread-tab-led-elsewhere-icon")).toBeNull();
    expect(tab("q-4")).toHaveAttribute("data-ownership-note", "");
    expect(tab("q-5")).toHaveAttribute("data-ownership-note", "");
  });

  it("names the leader that runs the quest in the quest header", () => {
    installLeader(ownershipProjection());
    render(<QuestThreadBanner row={bannerRow("q-2")} threadKey="q-2" />);

    const chip = screen.getByTestId("quest-thread-ownership-chip");
    expect(chip).toHaveTextContent("Led by#2851");
    expect(chip).toHaveAccessibleName("Led by leader #2851");
    // The quest's current worker stays visible; it belongs to the other leader's run.
    expect(screen.getByTestId("quest-thread-participant")).toHaveTextContent("#2914");
  });

  it("notes an unfinished quest that no board holds, and nothing for own or finished quests", () => {
    installLeader(ownershipProjection());
    const { rerender } = render(<QuestThreadBanner row={bannerRow("q-3")} threadKey="q-3" />);
    expect(screen.getByTestId("quest-thread-ownership-chip")).toHaveTextContent("Not on board");

    rerender(<QuestThreadBanner row={bannerRow("q-4")} threadKey="q-4" />);
    expect(screen.queryByTestId("quest-thread-ownership-chip")).toBeNull();

    rerender(<QuestThreadBanner row={bannerRow("q-5")} threadKey="q-5" />);
    expect(screen.queryByTestId("quest-thread-ownership-chip")).toBeNull();

    rerender(<QuestThreadBanner row={bannerRow("q-1")} threadKey="q-1" />);
    expect(screen.queryByTestId("quest-thread-ownership-chip")).toBeNull();
  });
});
