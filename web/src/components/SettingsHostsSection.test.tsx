// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsHostsSection } from "./SettingsHostsSection.js";
import type { RemoteHost } from "../remote-hosts.js";

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
    ...overrides,
  };
}

/** A fake of the server's host routes, so the section talks to the same API shape. */
function serveHostRoutes(initial: RemoteHost[] = [hostRow({ id: "h1", name: "devbox", processes: 2 })]) {
  let hosts = initial;
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
        return new Response(JSON.stringify({ host, token: "secret-token" }), { status: 201 });
      }
      if (method === "DELETE") {
        hosts = hosts.filter((host) => !url.endsWith(host.id));
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ hosts, build: SERVER_BUILD }));
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
      hostRow({ id: "h2", name: "auto", build: "a".repeat(40), buildMismatch: true, autoUpdate: true }),
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
    expect(auto).toContain("updates when none of its sessions is in a turn");
    expect(broken).toContain("Auto-update failed: uncommitted changes");
    expect(screen.getByTestId("settings-hosts-list").textContent).toContain("Takode bbbbbbbb · auto-update on");
  });
});
