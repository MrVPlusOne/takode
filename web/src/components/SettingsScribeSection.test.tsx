// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../api.js";

const mockUpdateSettings = vi.hoisted(() => vi.fn());
vi.mock("../api.js", () => ({
  api: { updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) },
}));

import { SettingsScribeSection } from "./SettingsScribeSection.js";

describe("Scribe settings", () => {
  beforeEach(() => mockUpdateSettings.mockReset());

  it("defaults to the leader's backend and saves a fixed one when chosen", async () => {
    // Scribes match their leader's backend unless the user picks one here.
    mockUpdateSettings.mockResolvedValue({ scribeBackend: "codex" });
    render(<SettingsScribeSection settings={{ scribeBackend: "leader" } as AppSettings} />);
    const select = screen.getByLabelText("Scribe backend");
    expect(select).toHaveValue("leader");

    fireEvent.change(select, { target: { value: "codex" } });

    expect(mockUpdateSettings).toHaveBeenCalledWith({ scribeBackend: "codex" });
    await waitFor(() => expect(select).toHaveValue("codex"));
  });

  it("shows Library topics on for leaders by default, and turns them off for every leader", async () => {
    // Topics are on unless the user turns them off here (for the rare token-saving case).
    mockUpdateSettings.mockResolvedValue({ leaderTopics: false });
    render(<SettingsScribeSection settings={{ scribeBackend: "leader" } as AppSettings} />);
    const toggle = screen.getByRole("switch", { name: "Library topics for leaders" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    expect(mockUpdateSettings).toHaveBeenCalledWith({ leaderTopics: false });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });
});
