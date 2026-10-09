// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { api, type AppSettings } from "../api.js";
import { SettingsServerTimeZoneSection } from "./SettingsServerTimeZoneSection.js";

const utcServer = {
  serverTimeZone: "",
  serverTimeZoneInEffect: "UTC",
  serverTimeZoneDefault: "UTC",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsServerTimeZoneSection", () => {
  it("shows the zone in effect, with no pending restart while the setting matches it", () => {
    render(<SettingsServerTimeZoneSection initial={utcServer} />);

    expect(screen.getByText(/In effect:/)).toHaveTextContent("In effect: UTC.");
    expect(screen.queryByText(/Restart the server/)).not.toBeInTheDocument();
    // An empty setting falls back to the machine's zone, shown as the placeholder.
    expect(screen.getByLabelText("Server Time Zone")).toHaveAttribute("placeholder", "UTC");
  });

  it("saves a new zone and says it applies at the next restart", async () => {
    // The server canonicalizes the name and keeps running in its current zone until it restarts.
    const update = vi.spyOn(api, "updateSettings").mockResolvedValue({
      ...utcServer,
      serverTimeZone: "America/Los_Angeles",
    } as AppSettings);
    render(<SettingsServerTimeZoneSection initial={utcServer} />);

    const input = screen.getByLabelText("Server Time Zone");
    fireEvent.change(input, { target: { value: " america/los_angeles " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(input).toHaveValue("America/Los_Angeles"));
    expect(update).toHaveBeenCalledWith({ serverTimeZone: "america/los_angeles" });
    expect(screen.getByText(/In effect:/)).toHaveTextContent(
      "In effect: UTC. Restart the server to switch to America/Los_Angeles.",
    );
  });

  it("shows the server's error for a name that is not a time zone", async () => {
    vi.spyOn(api, "updateSettings").mockRejectedValue(
      new Error('"Pacific Standard Time" is not a time zone; use an IANA name such as America/Los_Angeles'),
    );
    render(<SettingsServerTimeZoneSection initial={utcServer} />);

    const input = screen.getByLabelText("Server Time Zone");
    fireEvent.change(input, { target: { value: "Pacific Standard Time" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText(/is not a time zone/)).toBeInTheDocument();
    expect(input).toHaveValue("Pacific Standard Time");
  });
});
