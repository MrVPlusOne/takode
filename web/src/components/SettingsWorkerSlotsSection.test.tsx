// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../api.js";

const mockUpdateSettings = vi.hoisted(() => vi.fn());
vi.mock("../api.js", () => ({
  api: { updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) },
}));

import { SettingsWorkerSlotsSection } from "./SettingsWorkerSlotsSection.js";

const settings = { workerSlotLimits: { claude: 8, codex: 5 } } as AppSettings;

describe("worker slot settings", () => {
  beforeEach(() => {
    mockUpdateSettings.mockReset();
  });

  it("shows each backend's limit and saves only the one that changed", async () => {
    // The server merges a one-backend patch with the saved value of the other backend,
    // so stepping Codex must not resend Claude's limit.
    mockUpdateSettings.mockResolvedValue({ workerSlotLimits: { claude: 8, codex: 6 } });
    render(<SettingsWorkerSlotsSection settings={settings} />);
    expect(screen.getByLabelText("Claude leaders")).toHaveValue("8");
    expect(screen.getByLabelText("Codex leaders")).toHaveValue("5");

    fireEvent.click(screen.getByRole("button", { name: "Increase Codex leaders worker slots" }));

    expect(mockUpdateSettings).toHaveBeenCalledWith({ workerSlotLimits: { codex: 6 } });
    await waitFor(() => expect(screen.getByLabelText("Codex leaders")).toHaveValue("6"));
  });

  it("restores the previous limit and shows the error when saving fails", async () => {
    mockUpdateSettings.mockRejectedValue(new Error("workerSlotLimits rejected"));
    render(<SettingsWorkerSlotsSection settings={settings} />);

    fireEvent.click(screen.getByRole("button", { name: "Decrease Claude leaders worker slots" }));

    expect(await screen.findByText("workerSlotLimits rejected")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude leaders")).toHaveValue("8");
  });
});
