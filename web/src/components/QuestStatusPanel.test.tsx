// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../store.js";
import { QuestStatusPanel } from "./QuestStatusPanel.js";

describe("QuestStatusPanel", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("routes quest-context leader links to the matching thread", () => {
    useStore.setState({
      sessions: new Map([
        [
          "worker-1",
          {
            claimedQuestId: "q-42",
            claimedQuestTitle: "Threaded leader route",
            claimedQuestStatus: "in_progress",
          } as any,
        ],
      ]),
      quests: [
        {
          questId: "q-42",
          title: "Threaded leader route",
          status: "in_progress",
          sessionId: "worker-1",
          leaderSessionId: "leader-1",
          createdAt: 1,
        } as any,
      ],
      sdkSessions: [
        {
          sessionId: "leader-1",
          sessionNum: 7,
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          isOrchestrator: true,
        } as any,
      ],
    });

    render(<QuestStatusPanel sessionId="worker-1" />);

    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute("href", "#/session/7?thread=q-42");
  });
});
