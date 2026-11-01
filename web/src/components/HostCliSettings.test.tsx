// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HostCliSettings } from "./HostCliSettings.js";

/**
 * The per-machine switch for `takode exec`: it shows whether sessions may run
 * commands on the machine and saves the change as `execDisabled`.
 */
describe("HostCliSettings agent commands switch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows commands as allowed by default and saves turning them off", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/settings")
        ? new Response(JSON.stringify({ settings: { claudeBinary: "", codexBinary: "", execDisabled: true } }))
        : new Response(JSON.stringify({ hosts: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <HostCliSettings hostId="host-1" settings={{ claudeBinary: "", codexBinary: "" }} defaultWorktreeRoot={null} />,
    );

    const toggle = screen.getByRole("switch", { name: "Agents may run commands here" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/hosts/host-1/settings",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ execDisabled: true }) }),
      ),
    );
  });

  it("shows a machine the user turned off as off", () => {
    render(
      <HostCliSettings
        hostId="host-1"
        settings={{ claudeBinary: "", codexBinary: "", execDisabled: true }}
        defaultWorktreeRoot={null}
      />,
    );
    expect(screen.getByRole("switch", { name: "Agents may run commands here" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });
});
