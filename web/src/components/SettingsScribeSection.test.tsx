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

  it("has no switch to turn Library topics off: every leader has them", () => {
    render(<SettingsScribeSection settings={{ scribeBackend: "leader" } as AppSettings} />);
    expect(screen.queryByRole("switch", { name: "Library topics for leaders" })).toBeNull();
  });

  it("shows the Scribe context limit in K and saves a changed one in tokens", async () => {
    // Scribes keep running; this limit is what bounds their cost, so the user can change it here.
    mockUpdateSettings.mockResolvedValue({ scribeBackend: "leader", scribeContextLimitTokens: 288_000 });
    render(
      <SettingsScribeSection
        settings={{ scribeBackend: "leader", scribeContextLimitTokens: 256_000 } as AppSettings}
      />,
    );
    const input = screen.getByLabelText("Scribe context limit");
    expect(input).toHaveValue("256");

    fireEvent.click(screen.getByRole("button", { name: "Increase Scribe context limit" }));

    expect(mockUpdateSettings).toHaveBeenCalledWith({ scribeContextLimitTokens: 288_000 });
    await waitFor(() => expect(input).toHaveValue("288"));
  });
});
