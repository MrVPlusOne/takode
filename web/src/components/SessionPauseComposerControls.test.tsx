// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PausedInputChip, PauseOtherSourcesButton } from "./SessionPauseComposerControls.js";
import type { SessionPauseState } from "../types.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makePauseState(): SessionPauseState {
  return {
    pausedAt: 1_000,
    queuedMessages: [
      {
        id: "held-1",
        queuedAt: new Date("2026-05-08T10:15:00Z").getTime(),
        source: "programmatic",
        message: {
          type: "user_message",
          content: "Timer reminder while paused",
          agentSource: { sessionId: "timer:t1", sessionLabel: "Timer t1" },
        },
      },
      {
        id: "held-2",
        queuedAt: new Date("2026-05-08T10:16:00Z").getTime(),
        source: "browser",
        message: { type: "user_message", content: "Browser-origin external send" },
      },
    ],
  };
}

describe("PauseOtherSourcesButton", () => {
  it("uses explanatory tooltip copy and toggles pause from the composer area", async () => {
    const onToggle = vi.fn();
    render(<PauseOtherSourcesButton isPaused={false} heldCount={0} busy={false} onToggle={onToggle} />);

    const button = screen.getByTestId("composer-pause-sources-button");
    expect(button.getAttribute("title")).toBe(
      "Pause other input sources. Direct composer messages still send; CLI, timer, herd, and programmatic work is held.",
    );

    await userEvent.click(button);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("PausedInputChip", () => {
  it("shows paused mode and expands to inspect held messages", async () => {
    render(<PausedInputChip pause={makePauseState()} heldCount={2} />);

    expect(screen.getByTestId("composer-paused-chip").textContent).toContain("Other sources paused");
    expect(screen.getByText("2 held inputs")).toBeTruthy();
    expect(screen.queryByTestId("composer-held-input-list")).toBeNull();

    await userEvent.click(screen.getByTestId("composer-paused-chip"));

    const list = screen.getByTestId("composer-held-input-list");
    expect(list.textContent).toContain("Timer t1");
    expect(list.textContent).toContain("Timer reminder while paused");
    expect(list.textContent).toContain("Browser-origin external send");
  });

  it("stays visible with an empty held list while paused", async () => {
    render(<PausedInputChip pause={{ pausedAt: 1_000, queuedMessages: [] }} heldCount={0} />);

    await userEvent.click(screen.getByTestId("composer-paused-chip"));

    expect(screen.getByTestId("composer-held-input-list").textContent).toContain("No held input yet.");
  });
});
