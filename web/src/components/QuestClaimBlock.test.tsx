// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { topicApi } from "../api/topics.js";
import type { QuestTopicMap } from "../../shared/library-topics.js";
import { resetLeaderTopicsForTest } from "../utils/leader-topics.js";
import { useStore } from "../store.js";
import { QuestClaimBlock } from "./QuestClaimBlock.js";

describe("QuestClaimBlock", () => {
  beforeEach(() => {
    useStore.getState().reset();
    window.history.replaceState({}, "", "/#/session/worker-1");
  });

  afterEach(() => {
    resetLeaderTopicsForTest();
    vi.restoreAllMocks();
  });

  it("shows the quest's topic in place of its tags, and the tags when it has no topic", async () => {
    // Jiayi reads the topic and rarely the tags, so a quest with a topic shows only the topic.
    const questMap = vi.spyOn(topicApi, "questMap").mockImplementation(async (_leader, questIds) => {
      const map: QuestTopicMap = questIds.includes("q-90") ? { "q-90": { id: "t1", name: "Relay" } } : {};
      return { enabled: true, map, topics: {} };
    });
    const tagged = (questId: string) => ({
      questId,
      title: "Tagged quest",
      status: "in_progress",
      tags: ["ui", "improvement"],
      leaderSessionId: "leader-1",
    });
    const filed = render(<QuestClaimBlock quest={tagged("q-90")} />);
    // Collapsed cards ask nothing, so a feed full of them costs no lookups.
    expect(questMap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    await waitFor(() => expect(screen.getByTestId("quest-topic-link")).toHaveTextContent("Relay"));
    expect(screen.queryByText("improvement")).toBeNull();
    filed.unmount();

    render(<QuestClaimBlock quest={tagged("q-91")} />);
    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    await waitFor(() => expect(questMap).toHaveBeenCalledWith("leader-1", ["q-91"]));
    expect(screen.getByText("improvement")).toBeInTheDocument();
    expect(screen.queryByTestId("quest-topic-link")).toBeNull();
  });

  it("uses shared quest status colors for the status badge", () => {
    render(
      <QuestClaimBlock
        quest={{
          questId: "q-77",
          title: "Palette test",
          status: "in_progress",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    const inProgressBadge = screen.getByText("In Progress");
    expect(inProgressBadge).toHaveClass("text-cc-status-progress");
  });

  it("renders the canonical current title without rewriting the lifecycle snapshot", () => {
    useStore.getState().upsertQuestTitlePreview({
      questId: "q-77",
      title: "Canonical renamed quest",
      version: 4,
      updatedAt: 40,
      commitShas: [],
    });

    render(<QuestClaimBlock quest={{ questId: "q-77", title: "Claim-time title", status: "in_progress" }} />);

    expect(screen.getByText("Canonical renamed quest")).toBeInTheDocument();
    expect(screen.queryByText("Claim-time title")).toBeNull();
  });

  it("renders leader session attribution when the quest includes a leader", () => {
    useStore.getState().setSdkSessions([
      {
        sessionId: "leader-1",
        sessionNum: 42,
        state: "running",
        cwd: "/repo",
        createdAt: Date.now(),
        isOrchestrator: true,
      } as any,
    ]);

    render(
      <QuestClaimBlock
        quest={{
          questId: "q-78",
          title: "Leader attribution test",
          status: "in_progress",
          leaderSessionId: "leader-1",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));

    expect(screen.getByText("Leader")).toBeInTheDocument();
    const leaderChip = screen.getByRole("link", { name: "#42" });
    expect(leaderChip).toBeInTheDocument();

    fireEvent.click(leaderChip);

    expect(window.location.hash).toBe("#/session/42?thread=q-78");
  });

  it("closes the local details modal when the leader chip navigates", () => {
    useStore.getState().setSdkSessions([
      {
        sessionId: "leader-1",
        sessionNum: 42,
        state: "running",
        cwd: "/repo",
        createdAt: Date.now(),
        isOrchestrator: true,
      } as any,
    ]);

    render(
      <QuestClaimBlock
        quest={{
          questId: "q-78",
          title: "Leader attribution test",
          status: "in_progress",
          leaderSessionId: "leader-1",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(screen.getByRole("dialog", { name: /Quest details: Leader attribution test/i })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "#42" }));

    expect(screen.queryByRole("dialog", { name: /Quest details: Leader attribution test/i })).toBeNull();
    expect(window.location.hash).toBe("#/session/42?thread=q-78");
  });

  it("opens local details modal and keeps quest link scoped to the same id", () => {
    render(
      <QuestClaimBlock
        quest={{
          questId: "q-76",
          title: "Dummy quest",
          status: "in_progress",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    const dialog = screen.getByRole("dialog", { name: /Quest details: Dummy quest/i });
    expect(dialog).toBeInTheDocument();
    const viewLink = within(dialog).getByRole("link", { name: "Open in Questmaster" });
    expect(viewLink).toHaveAttribute("href", "#/questmaster?quest=q-76");
  });

  it("labels submitted checks as User review checks", () => {
    render(
      <QuestClaimBlock
        quest={{
          questId: "q-79",
          title: "Review checks label",
          status: "done",
          verificationItems: [{ text: "Inspect final UI", checked: false }],
        }}
        variant="submitted"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Ready for Review/i }));

    expect(screen.getByText("User review checks")).toBeInTheDocument();
    expect(screen.getByText("Inspect final UI")).toBeInTheDocument();
  });

  it("opens quest thumbnails in the shared lightbox overlay", async () => {
    render(
      <QuestClaimBlock
        quest={{
          questId: "q-75",
          title: "Image quest",
          status: "done",
          images: [{ id: "img-1", filename: "preview.png", mimeType: "image/png", path: "/tmp/preview.png" }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    fireEvent.click(screen.getByAltText("preview.png"));

    expect(await screen.findByTestId("lightbox-image")).toHaveAttribute("src", "/api/quests/_images/img-1");
  });
});
