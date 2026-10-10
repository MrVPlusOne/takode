import { describe, expect, it } from "vitest";
import type { ServerCheckoutStatus } from "./api/server-restart.js";
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

// The Restart section's checkout line must say plainly whether a restart loads the
// branch's latest code, and warn only when it cannot (the stale-restart incident).
describe("describeServerCheckout", () => {
  it("shows nothing for a server that does not run from Git", () => {
    expect(describeServerCheckout(null)).toBeNull();
    expect(describeServerCheckout(status({ state: "not-git" }))).toBeNull();
  });

  it("says an up-to-date checkout is current, and mentions a checkout that moved since the server started", () => {
    expect(describeServerCheckout(status({}))).toEqual({
      tone: "ok",
      text: "Running 11111111. Up to date with origin/main.",
    });
    expect(describeServerCheckout(status({ head: HEAD }))).toEqual({
      tone: "info",
      text: "Running 11111111. Up to date with origin/main. The checkout is at 22222222, which a restart loads.",
    });
  });

  it("tells the user a clean behind checkout is fast-forwarded by the restart", () => {
    expect(describeServerCheckout(status({ state: "behind", behind: 2 }))).toMatchObject({
      tone: "info",
      text: expect.stringContaining(
        "origin/main has 2 commits newer than the checkout (main); Restart Server fast-forwards",
      ),
    });
  });

  it("warns when a restart would load older code because the checkout cannot be fast-forwarded", () => {
    expect(describeServerCheckout(status({ state: "behind", behind: 1, localChanges: true }))).toMatchObject({
      tone: "warning",
      text: expect.stringContaining(
        "has uncommitted changes, so Restart Server leaves it alone and restarts onto older code",
      ),
    });
    expect(describeServerCheckout(status({ state: "diverged", behind: 3, ahead: 1 }))).toMatchObject({
      tone: "warning",
      text: expect.stringContaining("has 1 commit not on origin/main and lacks 3 commits from it"),
    });
  });

  it("warns when the branch could not be fetched, since the comparison may be out of date", () => {
    expect(describeServerCheckout(status({ fetchError: "fatal: unable to access remote\nmore detail" }))).toMatchObject(
      {
        tone: "warning",
        text: expect.stringContaining("Could not fetch origin/main (fatal: unable to access remote), so this compares"),
      },
    );
  });

  it("explains checkouts that a restart loads as they are", () => {
    expect(describeServerCheckout(status({ state: "detached", branch: null, upstream: null }))?.text).toContain(
      "not on a branch",
    );
    expect(describeServerCheckout(status({ state: "no-upstream", upstream: null }))?.text).toContain(
      "branch main tracks no remote branch",
    );
    expect(describeServerCheckout(status({ state: "ahead", ahead: 2 }))?.text).toContain(
      "The checkout (main) has 2 commits not on origin/main.",
    );
  });
});

describe("describeServerCheckoutUpdate", () => {
  it("reports a fast-forward, a failed one and a checkout left behind; nothing otherwise", () => {
    expect(
      describeServerCheckoutUpdate({ action: "updated", from: RUNNING, error: null, status: status({ head: HEAD }) }),
    ).toBe("The checkout (main) was first fast-forwarded from 11111111 to 22222222.");
    expect(
      describeServerCheckoutUpdate({ action: "failed", from: null, error: "not possible", status: status({}) }),
    ).toBe("Could not fast-forward the checkout (main): not possible. The server runs older code than origin/main.");
    expect(
      describeServerCheckoutUpdate({
        action: "unchanged",
        from: null,
        error: null,
        status: status({ state: "behind", behind: 1, localChanges: true }),
      }),
    ).toBe("The checkout (main) is 1 commit behind origin/main and was left as it is, so the server runs older code.");
    expect(describeServerCheckoutUpdate({ action: "unchanged", from: null, error: null, status: status({}) })).toBe("");
    expect(describeServerCheckoutUpdate(null)).toBe("");
  });
});
