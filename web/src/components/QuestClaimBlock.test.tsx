// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store.js";
import { QuestClaimBlock } from "./QuestClaimBlock.js";

describe("QuestClaimBlock", () => {
  beforeEach(() => {
    useStore.getState().reset();
    window.history.replaceState({}, "", "/#/session/worker-1");
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

  it("opens quest thumbnails in the shared lightbox overlay", () => {
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

    expect(screen.getByTestId("lightbox-image")).toHaveAttribute("src", "/api/quests/_images/img-1");
  });
});
