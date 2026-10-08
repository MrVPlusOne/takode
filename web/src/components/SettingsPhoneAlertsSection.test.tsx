// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppSettings } from "../api.js";

const mockUpdateSettings = vi.hoisted(() => vi.fn());
vi.mock("../api.js", () => ({
  api: {
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
    testPushover: vi.fn(),
  },
}));

import { SettingsPhoneAlertRules, SettingsPushoverSection } from "./SettingsPhoneAlertsSection.js";

const settings = {
  pushoverConfigured: true,
  pushoverEnabled: true,
  pushoverEventFilters: {
    needsInput: true,
    review: true,
    notifyMe: true,
    error: true,
  },
  pushoverDelaySeconds: 30,
  pushoverBaseUrl: "",
} as AppSettings;

describe("phone alert settings", () => {
  beforeEach(() => {
    mockUpdateSettings.mockReset();
  });

  it("saves the shared delay as soon as it is stepped", async () => {
    // The delay is shared by Web Push and Pushover, so it applies immediately
    // instead of waiting for the Pushover Save button.
    mockUpdateSettings.mockResolvedValue({
      ...settings,
      pushoverDelaySeconds: 35,
    });
    render(<SettingsPhoneAlertRules settings={settings} />);

    fireEvent.click(screen.getByRole("button", { name: "Increase delay" }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        pushoverDelaySeconds: 35,
      }),
    );
    expect(screen.getByLabelText("Delay")).toHaveValue("35");
  });

  it("restores the previous delay when the save fails", async () => {
    mockUpdateSettings.mockRejectedValue(new Error("save failed"));
    render(<SettingsPhoneAlertRules settings={settings} />);

    fireEvent.click(screen.getByRole("button", { name: "Decrease delay" }));

    expect(await screen.findByText("save failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Delay")).toHaveValue("30");
  });

  it("applies the Pushover switch immediately without touching credentials", async () => {
    mockUpdateSettings.mockResolvedValue({
      ...settings,
      pushoverEnabled: false,
    });
    render(<SettingsPushoverSection settings={settings} loading={false} />);

    const toggle = screen.getByRole("switch", { name: "Send Pushover alerts" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        pushoverEnabled: false,
      }),
    );
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
