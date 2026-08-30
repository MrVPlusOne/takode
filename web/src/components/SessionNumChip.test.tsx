// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store.js";
import { createSessionNavigationProjectionEnvelope } from "../test-fixtures/session-navigation-projection.js";
import { SessionNumChip } from "./SessionNumChip.js";

beforeEach(() => {
  vi.useFakeTimers();
  useStore.getState().reset();
});

afterEach(() => {
  useStore.getState().reset();
  vi.useRealTimers();
});

describe("SessionNumChip navigation projection", () => {
  it("uses projected identity, lifecycle, and git fields for its label and tooltip", async () => {
    useStore.getState().setSdkSessions([
      {
        sessionId: "s1",
        sessionNum: 7,
        state: "exited",
        cwd: "/legacy",
        createdAt: 1,
        name: "Legacy name",
        model: "legacy-model",
        backendType: "claude",
        cliConnected: false,
        gitBranch: "legacy-branch",
      },
    ]);
    useStore.getState().applySyncedProjectionSnapshot(
      createSessionNavigationProjectionEnvelope({
        key: "s1",
        overrides: {
          identity: { name: "Projected name", sessionNum: 42, model: "gpt-5.6-20260830", backendType: "codex" },
          lifecycle: { cliConnected: true, status: "running", sdkState: "running" },
          git: { branch: "projected-branch" },
        },
      }),
    );

    render(<SessionNumChip sessionId="s1" />);

    const chip = screen.getByRole("button", { name: "#42" });
    fireEvent.mouseEnter(chip);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByText("Projected name")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.6")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("projected-branch")).toBeInTheDocument();
  });
});
