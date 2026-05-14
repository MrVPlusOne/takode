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
          sessionId: "worker-1",
          sessionNum: 9,
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
        } as any,
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

    const leaderLink = screen.getByRole("link", { name: "#7" });
    const ownerLink = screen.getByRole("link", { name: "#9" });

    expect(leaderLink).toHaveAttribute("href", "#/session/7?thread=q-42");
    expect(leaderLink).toHaveClass("text-cc-info");
    expect(ownerLink).toHaveClass("text-cc-attention");
  });

  it("uses semantic attention tokens for status metrics and callouts", () => {
    useStore.setState({
      sessionBoards: new Map([
        [
          "leader-1",
          [
            {
              questId: "q-88",
              title: "Needs readable attention",
              status: "IMPLEMENTING",
              updatedAt: 10,
              waitForInput: ["leader approval"],
              journey: {
                phaseIds: ["alignment", "implement"],
                currentPhaseIndex: 1,
                mode: "active",
              },
            } as any,
          ],
        ],
      ]),
      quests: [
        {
          questId: "q-88",
          title: "Needs readable attention",
          status: "in_progress",
          sessionId: "worker-1",
          feedback: [{ author: "human", addressed: false, text: "Please re-check contrast.", ts: 1 }],
          createdAt: 1,
        } as any,
      ],
    });

    render(<QuestStatusPanel sessionId="leader-1" />);

    const attentionCallout = screen.getByText("Waiting for input: leader approval");
    expect(attentionCallout).toHaveClass("border-cc-attention-border", "bg-cc-attention-bg", "text-cc-attention");
    expect(attentionCallout.className).not.toContain("amber");

    const feedbackMetric = screen.getByText("Feedback").parentElement;
    expect(feedbackMetric).toHaveClass("border-cc-attention-border", "bg-cc-attention-bg", "text-cc-attention");
    expect(feedbackMetric?.className).not.toContain("amber");
  });
});
