// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SettingsLeaderProfilesSection } from "./SettingsLeaderProfilesSection.js";

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockUpdateSettings = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("SettingsLeaderProfilesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      leaderProfilePools: { tako: true, shmi: true, animals: false },
    });
    mockUpdateSettings.mockResolvedValue({
      leaderProfilePools: { tako: false, shmi: true, animals: false },
    });
  });

  it("loads enabled pools and persists pool toggles", async () => {
    render(<SettingsLeaderProfilesSection />);

    // The switches render disabled until the saved pools load, and a click on a
    // disabled switch is dropped, so wait for the load before toggling.
    const tako = await screen.findByRole("switch", { name: /tako/i });
    await waitFor(() => expect(tako).toBeEnabled());
    fireEvent.click(tako);

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        leaderProfilePools: { tako: false, shmi: true, animals: false },
      });
    });
  });

  it("disables every pool toggle while saving to avoid stale replacement writes", async () => {
    const save = deferred<{
      leaderProfilePools: { tako: boolean; shmi: boolean; animals: boolean };
    }>();
    mockUpdateSettings.mockReturnValue(save.promise);
    render(<SettingsLeaderProfilesSection />);

    const tako = await screen.findByRole("switch", { name: /tako/i });
    const shmi = screen.getByRole("switch", { name: /shmi/i });
    await waitFor(() => expect(tako).toBeEnabled());
    fireEvent.click(tako);

    await waitFor(() => {
      expect(tako).toBeDisabled();
      expect(shmi).toBeDisabled();
    });
    fireEvent.click(shmi);

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      leaderProfilePools: { tako: false, shmi: true, animals: false },
    });
    save.resolve({ leaderProfilePools: { tako: false, shmi: true, animals: false } });
    await waitFor(() => expect(tako).not.toBeDisabled());
  });
});
