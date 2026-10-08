// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { HostBadge, HostOfflineBanner } from "./HostBadge.js";
import { useStore } from "../store.js";
import { refreshRemoteHosts } from "../remote-hosts.js";

// The host list comes from the server's GET /api/hosts; stub it per test.
function serveHosts(hosts: Array<{ id: string; name: string; online: boolean; build?: string }>) {
  const serverBuild = "b".repeat(40);
  const row = (host: (typeof hosts)[number]) => {
    const build = host.build ?? serverBuild;
    return {
      ...host,
      build,
      buildMismatch: build !== serverBuild,
      autoUpdate: false,
      updating: false,
      updateError: null,
    };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hosts: hosts.map((h) => ({ ...row(h), createdAt: 0, lastSeenAt: null, processes: 0 })),
            build: serverBuild,
          }),
        ),
    ),
  );
}

describe("remote host session UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useStore.setState({ sdkSessions: [] });
  });

  // The sidebar chip names the host; the chat banner explains a stalled session
  // only while its host is offline, never for local sessions.
  it("names the host and explains when it is offline", async () => {
    serveHosts([{ id: "h1", name: "devbox", online: false }]);
    useStore.setState({
      sdkSessions: [
        { sessionId: "remote", hostId: "h1", state: "running", cwd: "/srv", createdAt: 0 },
        { sessionId: "local", state: "running", cwd: "/repo", createdAt: 0 },
      ] as never,
    });
    render(
      <>
        <HostBadge hostId="h1" />
        <HostOfflineBanner sessionId="remote" />
        <div data-testid="local-banner">
          <HostOfflineBanner sessionId="local" />
        </div>
      </>,
    );
    await act(async () => {
      await refreshRemoteHosts();
    });
    expect(screen.getByTestId("session-host-badge").textContent).toBe("devbox");
    expect(screen.getByTestId("host-offline-banner").textContent).toContain("devbox is offline");
    expect(screen.getByTestId("local-banner").textContent).toBe("");

    serveHosts([{ id: "h1", name: "devbox", online: true }]);
    await act(async () => {
      await refreshRemoteHosts();
    });
    expect(screen.queryByTestId("host-offline-banner")).toBeNull();
    expect(screen.getByTestId("session-host-badge").className).toContain("text-cc-info");

    // An online host on another build turns the chip into a warning that names both builds.
    serveHosts([{ id: "h1", name: "devbox", online: true, build: "a".repeat(40) }]);
    await act(async () => {
      await refreshRemoteHosts();
    });
    const badge = screen.getByTestId("session-host-badge");
    expect(badge.className).toContain("text-cc-warning");
    expect(badge.getAttribute("title")).toContain("Runs Takode aaaaaaaa, this server runs bbbbbbbb");
  });
});
