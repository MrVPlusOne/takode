// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SettingsLeaderProfilesSection } from "./SettingsLeaderProfilesSection.js";
import type { SettingsSectionId } from "./settings-search.js";

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockUpdateSettings = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
  },
}));

function sectionSearchProps() {
  return {
    results: {
      query: "",
      hasQuery: false,
      totalMatches: 0,
      visibleSectionIds: new Set<SettingsSectionId>(["leader-profiles"]),
      sectionMatchCounts: new Map(),
      visibleItemIds: new Map(),
    },
    id: "leader-profiles" as const,
  };
}

describe("SettingsLeaderProfilesSection", () => {
  beforeEach(() => {
    mockGetSettings.mockResolvedValue({ leaderProfilePools: { tako: true, shmi: true } });
    mockUpdateSettings.mockResolvedValue({ leaderProfilePools: { tako: false, shmi: true } });
  });

  it("loads enabled pools and persists pool toggles", async () => {
    render(<SettingsLeaderProfilesSection sectionSearchProps={sectionSearchProps()} />);

    const tako = await screen.findByRole("button", { name: /tako/i });
    fireEvent.click(tako);

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({ leaderProfilePools: { tako: false, shmi: true } });
    });
  });
});
