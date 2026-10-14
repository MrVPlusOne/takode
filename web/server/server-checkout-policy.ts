import type { ServerCheckoutStatus } from "./server-checkout.js";

// What Restart Server requires of the server checkout, kept free of Git and
// process calls so routes can describe it without running anything.

/**
 * Whether Restart Server brings the checkout up to date first: `on`, `off`
 * (turned off in Settings) or `development` (development servers restart onto
 * their working tree as it is).
 */
export type ServerCheckoutRestartMode = "on" | "off" | "development";

/** The Settings > Restart toggle for the update, as restart errors name it. */
export const RESTART_UPDATES_CHECKOUT_LABEL = "Update the checkout before restarting";

/**
 * Why a restart cannot bring this checkout up to date with its branch, as a
 * sentence saying what to do; null when it can.
 */
export function checkoutUpdateBlocker(status: ServerCheckoutStatus): string | null {
  const checkout = `The server checkout${status.branch ? ` (${status.branch})` : ""}`;
  switch (status.state) {
    case "not-git":
      return null;
    case "detached":
      return `${checkout} is not on a branch, so it has no branch to follow. Check out the branch it should run.`;
    case "no-upstream":
      return `${checkout} tracks no remote branch, so there is nothing to update it from. Set one with \`git branch --set-upstream-to\`.`;
  }
  if (status.localChanges) {
    return `${checkout} has uncommitted changes to tracked files. Commit or discard them.`;
  }
  if (status.state === "diverged") {
    return `${checkout} has ${commits(status.ahead, "local commit")} not on ${status.upstream} and lacks ${commits(status.behind, "commit")} from it. Merge or rebase it.`;
  }
  if (status.state === "ahead") {
    return `${checkout} has ${commits(status.ahead, "local commit")} not on ${status.upstream}. Push them or reset the checkout to ${status.upstream}.`;
  }
  if (status.fetchError) {
    return `Could not fetch ${status.upstream} (${status.fetchError.split("\n")[0]}), so the checkout may be behind it. Check that the server can reach its remote.`;
  }
  return null;
}

function commits(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
