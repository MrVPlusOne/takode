// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "../../store.js";
import { PlaygroundWaitingWorkers } from "./PlaygroundWaitingWorkers.js";

afterEach(() => {
  cleanup();
  useStore.setState({ sdkSessions: [] });
});

describe("PlaygroundWaitingWorkers", () => {
  it("shows each waiting worker's wait in sidebar rows and the board, and keeps the idle worker plain", async () => {
    // The Playground mock for the waiting-worker states: background job, lease
    // line, landing run, timer plus jobs, and a worker waiting on nothing.
    render(<PlaygroundWaitingWorkers />);
    const section = screen.getByTestId("playground-waiting-workers");

    expect(
      within(section)
        .getAllByTestId("session-waiting-for")
        .map((label) => label.textContent),
    ).toEqual([
      'background job "Run full gate"',
      "full-suite:takode@devbox (#2 in line)",
      "landing run",
      '2 background jobs: "Run full gate", "Dev server", 1 timer',
    ]);

    // Board rows resolve worker status from the seeded sessions.
    await waitFor(() => expect(within(section).getAllByTestId("board-participant-waiting")).toHaveLength(4));
    expect(within(section).getAllByTestId("board-participant-waiting")[0]).toHaveTextContent(
      'background job "Run full gate"',
    );
    expect(
      within(section)
        .getAllByTestId("session-status-dot")
        .map((dot) => dot.getAttribute("data-status")),
    ).toEqual(["idle", "idle"]);
  });
});
