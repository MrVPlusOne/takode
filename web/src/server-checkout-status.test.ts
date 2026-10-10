import { describe, expect, it } from "vitest";
import type { ServerCheckoutInfo, ServerCheckoutStatus } from "./api/server-restart.js";
import { describeServerCheckout, describeServerCheckoutUpdate } from "./server-checkout-status.js";

const RUNNING = "1".repeat(40);
const HEAD = "2".repeat(40);

function status(overrides: Partial<ServerCheckoutStatus>): ServerCheckoutStatus {
  return {
    state: "current",
    runningCommit: RUNNING,
    head: RUNNING,
    branch: "main",
    upstream: "origin/main",
    upstreamHead: RUNNING,
    behind: 0,
    ahead: 0,
    localChanges: false,
    fetchError: null,
    checkedAt: 1,
    ...overrides,
  };
}

/** What `GET /api/server/checkout` returns for a production server with the update on, unless overridden. */
function info(statusOverrides: Partial<ServerCheckoutStatus>, overrides: Partial<ServerCheckoutInfo> = {}) {
  return { status: status(statusOverrides), restartMode: "on", blocker: null, ...overrides } as ServerCheckoutInfo;
}

// The Restart section's checkout line must say plainly what Restart Server will do
// with the checkout: update it, stop and say why, or load it as it is.
describe("describeServerCheckout", () => {
  it("shows nothing for a server that does not run from Git", () => {
    expect(describeServerCheckout(null)).toBeNull();
    expect(describeServerCheckout({ status: null, restartMode: "on", blocker: null })).toBeNull();
    expect(describeServerCheckout(info({ state: "not-git" }))).toBeNull();
  });

  it("says an up-to-date checkout is current, and mentions a checkout that moved since the server started", () => {
    expect(describeServerCheckout(info({}))).toEqual({
      tone: "ok",
      text: "Running 11111111. Up to date with origin/main.",
    });
    expect(describeServerCheckout(info({ head: HEAD }))).toEqual({
      tone: "info",
      text: "Running 11111111. Up to date with origin/main. The checkout is at 22222222, which a restart loads.",
    });
  });

  it("tells the user a clean behind checkout is fast-forwarded and installed by the restart", () => {
    expect(describeServerCheckout(info({ state: "behind", behind: 2 }))).toEqual({
      tone: "info",
      text: "Running 11111111. origin/main has 2 commits newer than the checkout (main); Restart Server fast-forwards it and installs dependencies first.",
    });
  });

  it("warns ahead of time, in the server's words, when a restart would stop", () => {
    // The server computes the reason (local changes, local commits, no branch, failed fetch).
    const blocker = "The server checkout (main) has uncommitted changes to tracked files. Commit or discard them.";
    expect(describeServerCheckout(info({ state: "behind", behind: 1, localChanges: true }, { blocker }))).toEqual({
      tone: "warning",
      text: `Running 11111111. Restart Server would stop without restarting: ${blocker}`,
    });
  });

  it("warns when the update is turned off and the branch has newer code; otherwise just says so", () => {
    expect(describeServerCheckout(info({ state: "behind", behind: 1 }, { restartMode: "off" }))).toEqual({
      tone: "warning",
      text: "Running 11111111. origin/main has 1 commit newer than the checkout (main), but updating before restarts is turned off, so Restart Server loads the checkout as it is.",
    });
    expect(describeServerCheckout(info({ state: "ahead", ahead: 2 }, { restartMode: "off" }))).toEqual({
      tone: "info",
      text: "Running 11111111. Updating before restarts is turned off, so Restart Server loads the checkout as it is.",
    });
  });

  it("says a development server restarts onto its working tree as it is", () => {
    expect(
      describeServerCheckout(
        info({ state: "no-upstream", upstream: null, head: HEAD }, { restartMode: "development" }),
      ),
    ).toEqual({
      tone: "info",
      text: "Running 11111111. This development server restarts onto its checkout as it is. The checkout is at 22222222, which a restart loads.",
    });
  });
});

describe("describeServerCheckoutUpdate", () => {
  it("reports a fast-forward; nothing otherwise", () => {
    expect(
      describeServerCheckoutUpdate({ action: "updated", from: RUNNING, error: null, status: status({ head: HEAD }) }),
    ).toBe("The checkout (main) was first fast-forwarded from 11111111 to 22222222.");
    expect(describeServerCheckoutUpdate({ action: "unchanged", from: null, error: null, status: status({}) })).toBe("");
    expect(describeServerCheckoutUpdate(null)).toBe("");
  });
});
