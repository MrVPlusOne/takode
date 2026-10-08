// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsHostsSection } from "./SettingsHostsSection.js";

/** A fake of the server's host routes, so the section talks to the same API shape. */
function serveHostRoutes() {
  let hosts = [{ id: "h1", name: "devbox", createdAt: 0, online: true, lastSeenAt: 1, processes: 2 }];
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url}`);
      if (method === "POST") {
        const { name } = JSON.parse(String(init?.body)) as { name: string };
        const host = { id: "h2", name, createdAt: 0, online: false, lastSeenAt: null, processes: 0 };
        hosts = [...hosts, host];
        return new Response(JSON.stringify({ host, token: "secret-token" }), { status: 201 });
      }
      if (method === "DELETE") {
        hosts = hosts.filter((host) => !url.endsWith(host.id));
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ hosts }));
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
    render(<SettingsHostsSection sectionSearchProps={{}} />);
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
});
