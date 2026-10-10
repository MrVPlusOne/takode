// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { HostBadge, HostOfflineBanner, SessionHostBadge, SessionMachineRow } from "./HostBadge.js";
import { useStore } from "../store.js";
import { refreshRemoteHosts } from "../remote-hosts.js";

// The host list comes from the server's GET /api/hosts; stub it per test.
function serveHosts(
  hosts: Array<{ id: string; name: string; online: boolean; build?: string; lastSeenAt?: number | null }>,
) {
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
      updateWaitingFor: null,
    };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            hosts: hosts.map((h) => ({ ...row(h), createdAt: 0, lastSeenAt: h.lastSeenAt ?? null, processes: 0 })),
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
    serveHosts([{ id: "h1", name: "devbox", online: false, lastSeenAt: Date.now() - 5 * 60_000 }]);
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
    // An offline host keeps the neutral chip and gains only an unplugged icon; the word
    // "offline" is screen-reader text, and the tooltip says when the host was last seen.
    const offlineBadge = screen.getByTestId("session-host-badge");
    expect(offlineBadge.textContent).toBe("devbox (offline)");
    expect(offlineBadge.querySelector(".sr-only")?.textContent).toBe(" (offline)");
    expect(offlineBadge.querySelector('[data-testid="session-host-offline-icon"]')).not.toBeNull();
    expect(offlineBadge.getAttribute("title")).toBe(
      "Runs on devbox. Offline, last seen 5m ago. The session continues when the host reconnects.",
    );
    expect(offlineBadge.className).toContain("text-cc-muted bg-cc-muted/10");
    expect(screen.getByTestId("host-offline-banner").textContent).toContain("devbox is offline");
    expect(screen.getByTestId("local-banner").textContent).toBe("");

    serveHosts([{ id: "h1", name: "devbox", online: true }]);
    await act(async () => {
      await refreshRemoteHosts();
    });
    expect(screen.queryByTestId("host-offline-banner")).toBeNull();
    // Online adds nothing: same neutral chip, no icon.
    const onlineBadge = screen.getByTestId("session-host-badge");
    expect(onlineBadge.className).toContain("text-cc-muted bg-cc-muted/10");
    expect(onlineBadge.querySelector('[data-testid="session-host-offline-icon"]')).toBeNull();
    expect(onlineBadge.textContent).toBe("devbox");

    // An online host on another build keeps the neutral chip; its tooltip names both builds.
    serveHosts([{ id: "h1", name: "devbox", online: true, build: "a".repeat(40) }]);
    await act(async () => {
      await refreshRemoteHosts();
    });
    const badge = screen.getByTestId("session-host-badge");
    expect(badge.className).toContain("text-cc-muted bg-cc-muted/10");
    expect(badge.querySelector('[data-testid="session-host-offline-icon"]')).toBeNull();
    expect(badge.getAttribute("title")).toContain("Runs Takode aaaaaaaa, this server runs bbbbbbbb");
  });

  // Session-scoped surfaces (top bar, worker cards, board) show the chip only for
  // remote sessions; the info panel names the machine, and labels a local session
  // only while some session runs remotely, so single-machine setups see no change.
  it("labels sessions by machine in chips and the info panel", async () => {
    serveHosts([{ id: "h1", name: "devbox", online: true }]);
    useStore.setState({
      sdkSessions: [
        { sessionId: "remote", hostId: "h1", state: "running", cwd: "/srv", createdAt: 0 },
        { sessionId: "local", state: "running", cwd: "/repo", createdAt: 0 },
      ] as never,
    });
    render(
      <>
        <div data-testid="remote-chip">
          <SessionHostBadge sessionId="remote" />
        </div>
        <div data-testid="local-chip">
          <SessionHostBadge sessionId="local" />
        </div>
        <div data-testid="remote-row">
          <SessionMachineRow sessionId="remote" />
        </div>
        <div data-testid="local-row">
          <SessionMachineRow sessionId="local" />
        </div>
      </>,
    );
    await act(async () => {
      await refreshRemoteHosts();
    });
    expect(screen.getByTestId("remote-chip").textContent).toBe("devbox");
    expect(screen.getByTestId("local-chip").textContent).toBe("");
    expect(screen.getByTestId("remote-row").textContent).toBe("Runs ondevboxOnline");
    expect(screen.getByTestId("local-row").textContent).toBe("Runs onThis server's machine");

    // Without any remote session, the local label disappears.
    act(() => {
      useStore.setState({
        sdkSessions: [{ sessionId: "local", state: "running", cwd: "/repo", createdAt: 0 }] as never,
      });
    });
    expect(screen.getByTestId("local-row").textContent).toBe("");
  });

  // A session whose host was removed says so instead of claiming it is offline.
  it("explains a removed host in the info panel", async () => {
    serveHosts([]);
    useStore.setState({
      sdkSessions: [{ sessionId: "orphan", hostId: "gone", state: "exited", cwd: "/srv", createdAt: 0 }] as never,
    });
    render(<SessionMachineRow sessionId="orphan" />);
    await act(async () => {
      await refreshRemoteHosts();
    });
    expect(screen.getByTestId("session-info-machine-status").textContent).toBe("It is no longer registered.");
    expect(screen.getByTestId("session-host-badge").getAttribute("title")).toBe(
      "Runs on a removed host. It is no longer registered.",
    );
    // A removed host cannot run the session either, so its chip carries the unplugged icon too.
    expect(screen.getByTestId("session-host-offline-icon")).toBeTruthy();
    expect(screen.getByTestId("session-host-badge").textContent).toBe("remote (no longer registered)");
  });
});
