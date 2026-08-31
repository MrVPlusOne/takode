// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import type { SidebarSessionItem } from "../utils/sidebar-session-item.js";
import { PickerSessionChip } from "./QuestPickerSessionChip.js";

const state = {
  sessionTaskPreview: new Map([["s1", { text: "Newer task", updatedAt: 150 }]]),
  sessionPreviewUpdatedAt: new Map([["s1", 200]]),
};

vi.mock("../store.js", () => ({
  useStore: (selector: (value: typeof state) => unknown) => selector(state),
}));

function session(): SidebarSessionItem {
  return {
    id: "s1",
    lastUserMessageAt: 100,
    lastMessagePreviewAt: 200,
    model: "gpt-5.6",
    cwd: "/repo",
    gitBranch: "main",
    isContainerized: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: true,
    status: "idle",
    sdkState: "connected",
    createdAt: 1,
    archived: false,
    backendType: "codex",
    repoRoot: "/repo",
    permCount: 0,
  };
}

describe("PickerSessionChip projection preview freshness", () => {
  it("uses the projected preview timestamp separately from human activity timing", () => {
    render(
      <PickerSessionChip
        session={session()}
        sessionName="Worker"
        sessionPreview="Projected injected preview"
        onClick={() => {}}
      />,
    );

    expect(screen.getByText("Projected injected preview")).toBeInTheDocument();
    expect(screen.queryByText("Newer task")).toBeNull();
  });

  it("does not revive stale local preview timing after the projection clears it", () => {
    const cleared = session();
    delete cleared.lastMessagePreviewAt;

    render(<PickerSessionChip session={cleared} sessionName="Worker" sessionPreview={undefined} onClick={() => {}} />);

    expect(screen.getByText("Newer task")).toBeInTheDocument();
  });
});
