// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsHostsSection } from "./SettingsHostsSection.js";
import type { MachineSettings, RemoteHost } from "../remote-hosts.js";

const SERVER_BUILD = "b".repeat(40);

/** A host as GET /api/hosts reports it, running this server's build unless overridden. */
function hostRow(overrides: Partial<RemoteHost> & Pick<RemoteHost, "id" | "name">): RemoteHost {
  return {
    createdAt: 0,
    online: true,
    lastSeenAt: 1,
    processes: 0,
    build: SERVER_BUILD,
    buildMismatch: false,
    autoUpdate: false,
    updating: false,
    updateError: null,
    updateWaitingFor: null,
    settings: { claudeBinary: "", codexBinary: "" },
    commandOverrides: {},
    ...overrides,
  };
}

/** A fake of the server's host routes, so the section talks to the same API shape. */
function serveHostRoutes(initial: RemoteHost[] = [hostRow({ id: "h1", name: "devbox", processes: 2 })]) {
  let hosts = initial;
  let localSettings: MachineSettings = { claudeBinary: "", codexBinary: "" };
  const localNode = hostRow({ id: "local", name: "local", online: false, processes: 0 });
  let localName = "laptop";
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url}`);
      if (method === "POST") {
        const { name } = JSON.parse(String(init?.body)) as { name: string };
        const host = hostRow({ id: "h2", name, online: false, lastSeenAt: null, build: null });
        hosts = [...hosts, host];
        return new Response(JSON.stringify({ host, token: "secret-token", hostPort: 4456 }), { status: 201 });
      }
      if (method === "PUT" && url.endsWith("/name")) {
        // PUT /api/hosts/:id/name: names are unique across machines, as on the server.
        const { name } = JSON.parse(String(init?.body)) as { name: string };
        const id = url.split("/")[3]!;
        if (name === localName || hosts.some((host) => host.name === name && host.id !== id)) {
          return new Response(JSON.stringify({ error: `A machine named ${name} already exists` }), { status: 400 });
        }
        if (id === "local") localName = name;
        else hosts = hosts.map((host) => (host.id === id ? { ...host, name } : host));
        return new Response(JSON.stringify({ name }));
      }
      if (method === "PUT") {
        // PUT /api/hosts/:id/settings, as the server answers it.
        const patch = JSON.parse(String(init?.body)) as Partial<MachineSettings>;
        const id = url.split("/")[3]!;
        if (id === "local") {
          localSettings = { ...localSettings, ...patch };
          return new Response(JSON.stringify({ settings: localSettings }));
        }
        hosts = hosts.map((host) => (host.id === id ? { ...host, settings: { ...host.settings, ...patch } } : host));
        return new Response(JSON.stringify({ settings: hosts.find((host) => host.id === id)!.settings }));
      }
      if (method === "DELETE") {
        hosts = hosts.filter((host) => !url.endsWith(host.id));
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(
        JSON.stringify({
          hosts,
          build: SERVER_BUILD,
          local: { id: "local", name: localName, settings: localSettings, node: localNode },
        }),
      );
    }),
  );
  return requests;
}

describe("SettingsHostsSection", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Registering shows the one-time token inside the command to run on the host;
  // removing asks for a second click because it revokes the host's token.
  it("lists hosts, registers one with its token, and removes one after confirmation", async () => {
    const requests = serveHostRoutes();
    render(<SettingsHostsSection />);
    await waitFor(() => expect(screen.getByTestId("settings-hosts-list").textContent).toContain("devbox"));
    expect(screen.getByTestId("settings-hosts-list").textContent).toContain("Online · 2 processes");

    fireEvent.change(screen.getByLabelText("New host name"), { target: { value: "laptop" } });
    await act(async () => fireEvent.click(screen.getByText("Add host")));
    await waitFor(() => expect(screen.getByText(/secret-token/)).toBeTruthy());
    expect(screen.getByText(/takode-node\.ts --coordinator/)).toBeTruthy();
    // Hosts connect to the host port, which the server reports with the registration.
    expect(screen.getByText(/host port 4456/)).toBeTruthy();
    expect(screen.getByTestId("settings-hosts-list").textContent).toContain("laptop");

    fireEvent.click(screen.getAllByText("Remove")[0]!);
    expect(requests.some((request) => request.startsWith("DELETE"))).toBe(false);
    await act(async () => fireEvent.click(screen.getByText("Confirm remove")));
    await waitFor(() => expect(screen.getByTestId("settings-hosts-list").textContent).not.toContain("devbox"));
    expect(requests).toContain("DELETE /api/hosts/h1");
  });

  // A host on another build is called out with both commits and what
  // auto-update is doing, so the user knows whether to act.
  it("warns about hosts running another build", async () => {
    serveHostRoutes([
      hostRow({ id: "h1", name: "manual", build: "a".repeat(40), buildMismatch: true }),
      hostRow({
        id: "h2",
        name: "auto",
        build: "a".repeat(40),
        buildMismatch: true,
        autoUpdate: true,
        updateWaitingFor: "its sessions finish their turns",
      }),
      hostRow({
        id: "h3",
        name: "broken",
        build: "a".repeat(40),
        buildMismatch: true,
        autoUpdate: true,
        updateError: "uncommitted changes",
      }),
      hostRow({ id: "h4", name: "current", autoUpdate: true }),
    ]);
    render(<SettingsHostsSection />);
    await waitFor(() => expect(screen.getAllByTestId("host-build-warning")).toHaveLength(3));
    const [manual, auto, broken] = screen.getAllByTestId("host-build-warning").map((node) => node.textContent);
    expect(manual).toContain("Runs Takode aaaaaaaa, this server runs bbbbbbbb");
    expect(manual).toContain("--auto-update");
    expect(auto).toContain("It updates once its sessions finish their turns.");
    expect(broken).toContain("Auto-update failed: uncommitted changes");
    expect(screen.getByTestId("settings-hosts-list").textContent).toContain("Takode bbbbbbbb · auto-update on");
  });

  // This machine is always listed first and cannot be removed; each machine's
  // Claude/Codex programs save when the field loses focus, and a program the
  // host's takode node was started with is shown as overriding the setting.
  it("edits each machine's Claude and Codex programs and shows node overrides", async () => {
    const requests = serveHostRoutes([
      hostRow({ id: "h1", name: "devbox", commandOverrides: { claude: "/opt/claude-copilot" } }),
    ]);
    render(<SettingsHostsSection />);
    await waitFor(() => expect(screen.getByTestId("settings-local-host")).toBeTruthy());
    expect(screen.getByTestId("settings-local-host").textContent).not.toContain("Remove");

    const localClaude = screen.getByLabelText("Claude Code", { selector: "#local-claude-binary" });
    fireEvent.focus(localClaude);
    fireEvent.change(localClaude, { target: { value: " /usr/local/bin/claude " } });
    await act(async () => fireEvent.blur(localClaude));
    await waitFor(() => expect(requests).toContain("PUT /api/hosts/local/settings"));
    await waitFor(() => expect((localClaude as HTMLInputElement).value).toBe("/usr/local/bin/claude"));

    const remoteCodex = screen.getByLabelText("Codex", { selector: "#h1-codex-binary" });
    fireEvent.focus(remoteCodex);
    fireEvent.change(remoteCodex, { target: { value: "/opt/codex" } });
    await act(async () => fireEvent.blur(remoteCodex));
    await waitFor(() => expect(requests).toContain("PUT /api/hosts/h1/settings"));

    expect(screen.getByTestId("host-claude-override").textContent).toContain("/opt/claude-copilot");
    expect(screen.queryByTestId("host-codex-override")).toBeNull();
  });

  // This machine's sessions always run under its node, so its card shows how
  // the node is doing and offers no switch to turn it off.
  it("shows this machine's node status without a switch", async () => {
    serveHostRoutes([]);
    render(<SettingsHostsSection />);
    const status = await screen.findByTestId("settings-local-node");
    expect(status.textContent).toContain("so a server restart does not interrupt them");
    expect(status.textContent).toContain("Node starting");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  // Every machine, this server's included, shows its own name and can be
  // renamed in place; a host only while it is connected, since it keeps its name.
  it("shows and renames machines by their own names", async () => {
    const requests = serveHostRoutes([
      hostRow({ id: "h1", name: "devbox" }),
      hostRow({ id: "h2", name: "sleepy", online: false }),
    ]);
    render(<SettingsHostsSection />);
    await waitFor(() => expect(screen.getByTestId("settings-local-host").textContent).toContain("laptop"));
    expect(screen.getByTestId("settings-local-host").textContent).not.toContain("This machine");

    const renameButtons = screen.getAllByText("Rename") as HTMLButtonElement[];
    expect(renameButtons.map((button) => button.disabled)).toEqual([false, false, true]);

    fireEvent.click(renameButtons[0]!);
    const input = screen.getByLabelText("New name for laptop");
    fireEvent.change(input, { target: { value: "devbox" } });
    await act(async () => fireEvent.click(screen.getByText("Save")));
    await waitFor(() => expect(screen.getByText("A machine named devbox already exists")).toBeTruthy());

    fireEvent.change(input, { target: { value: "old-laptop" } });
    await act(async () => fireEvent.click(screen.getByText("Save")));
    await waitFor(() => expect(screen.getByTestId("settings-local-host").textContent).toContain("old-laptop"));
    expect(requests).toContain("PUT /api/hosts/local/name");
  });
});
