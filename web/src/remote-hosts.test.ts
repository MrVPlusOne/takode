import { hostRestartProgress, type RemoteHost } from "./remote-hosts.js";

function host(overrides: Partial<RemoteHost>): RemoteHost {
  return {
    id: "h1",
    name: "devbox",
    createdAt: 0,
    online: true,
    lastSeenAt: 1,
    processes: 0,
    build: "a".repeat(40),
    buildMismatch: true,
    autoUpdate: true,
    updating: false,
    updateError: null,
    updateWaitingFor: null,
    settings: { claudeBinary: "", codexBinary: "" },
    commandOverrides: {},
    ...overrides,
  };
}

// After a restart, each machine reports where it is in moving its sessions
// onto the server's new build; a single-machine setup lists nothing.
describe("hostRestartProgress", () => {
  it("lists nothing without remote hosts", () => {
    expect(hostRestartProgress({ hosts: [], local: null })).toEqual([]);
  });

  it("tells each host's state, failures and offline hosts included", () => {
    const states = hostRestartProgress({
      local: null,
      hosts: [
        host({ id: "done", buildMismatch: false }),
        host({ id: "failed", updateError: "uncommitted changes" }),
        host({ id: "updating", updating: true }),
        host({ id: "waiting", updateWaitingFor: "its sessions are taken over" }),
        host({ id: "soon" }),
        host({ id: "manual", autoUpdate: false }),
        host({ id: "offline", online: false }),
      ],
    }).map((row) => [row.id, row.state, row.detail]);
    expect(states).toEqual([
      ["done", "done", "On the new build"],
      ["failed", "failed", "Update failed: uncommitted changes"],
      ["updating", "updating", "Updating; its sessions continue once it is back"],
      ["waiting", "waiting", "Updates once its sessions are taken over"],
      ["soon", "updating", "Updating shortly"],
      ["manual", "manual", "On another build; update takode there by hand"],
      ["offline", "offline", "Offline; it updates when it reconnects"],
    ]);
  });
});
