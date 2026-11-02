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

/**
 * The per-machine note for agents: several lines (Enter does not save it), saved
 * when the field loses focus.
 */
describe("HostCliSettings note for agents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps Enter for new lines and saves the note when the field loses focus", async () => {
    const note = "15 CPUs and 56 GB shared.\nnproc is wrong.";
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ settings: { claudeBinary: "", codexBinary: "", note } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <HostCliSettings hostId="local" settings={{ claudeBinary: "", codexBinary: "" }} defaultWorktreeRoot={null} />,
    );

    const field = screen.getByLabelText("Note for agents");
    field.focus();
    fireEvent.change(field, { target: { value: note } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.blur(field);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/hosts/local/settings",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ note }) }),
      ),
    );
  });
});
