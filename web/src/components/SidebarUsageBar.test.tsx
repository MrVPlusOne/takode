// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { UsageLimits } from "../api.js";

interface MockStoreState {
  currentSessionId: string | null;
  showUsageBars: boolean;
  sessions: Map<string, { backend_type?: "claude" | "codex" }>;
  sdkSessions: Array<{ sessionId: string; backendType?: "claude" | "codex" }>;
}

let mockState: MockStoreState;
const mockUseUsageLimits = vi.fn<(sessionId: string | null) => UsageLimits | null>();

vi.mock("../store.js", () => ({
  useStore: (selector: (state: MockStoreState) => unknown) => selector(mockState),
}));

vi.mock("../hooks/useUsageLimits.js", () => ({
  useUsageLimits: (sessionId: string | null) => mockUseUsageLimits(sessionId),
}));

import { SidebarUsageBar } from "./SidebarUsageBar.js";

beforeEach(() => {
  mockState = {
    currentSessionId: "s1",
    showUsageBars: true,
    sessions: new Map(),
    sdkSessions: [],
  };
  mockUseUsageLimits.mockReset();
});

function makeLimits(): UsageLimits {
  return {
    five_hour: {
      utilization: 12,
      resets_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    seven_day: null,
    extra_usage: null,
  };
}

describe("SidebarUsageBar", () => {
  it("shows Codex icon and label for codex sessions", () => {
    mockState.sessions.set("s1", { backend_type: "codex" });
    mockUseUsageLimits.mockReturnValue(makeLimits());

    render(<SidebarUsageBar />);

    expect(screen.getByAltText("Codex usage")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("5H")).toBeInTheDocument();
  });

  it("shows Claude icon and label for claude sessions", () => {
    mockState.sessions.set("s1", { backend_type: "claude" });
    mockUseUsageLimits.mockReturnValue(makeLimits());

    render(<SidebarUsageBar />);

    expect(screen.getByAltText("Claude usage")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("5H")).toBeInTheDocument();
  });
});
