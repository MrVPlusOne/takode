import type { ServerCheckoutInfo, ServerCheckoutUpdate } from "./api/server-restart.js";

export interface ServerCheckoutDescription {
  /** `warning`: Restart Server would stop, or would load older code than the server's branch has. */
  tone: "ok" | "info" | "warning";
  text: string;
}

function short(commit: string | null): string {
  return commit ? commit.slice(0, 8) : "unknown";
}

function commits(count: number): string {
  return `${count} commit${count === 1 ? "" : "s"}`;
}

/**
 * Plain-language summary of the server checkout for the Restart section: what
 * the server runs, where its checkout stands against its branch, and what
 * Restart Server will do with it. Null when the server does not run from Git.
 */
export function describeServerCheckout(checkout: ServerCheckoutInfo | null): ServerCheckoutDescription | null {
  const status = checkout?.status;
  if (!checkout || !status || status.state === "not-git") return null;
  const running = status.runningCommit ? `Running ${short(status.runningCommit)}.` : "";
  const moved =
    status.runningCommit && status.head && status.runningCommit !== status.head
      ? ` The checkout is at ${short(status.head)}, which a restart loads.`
      : "";
  const upstream = status.upstream ?? "its branch";
  const newer =
    status.behind > 0 ? `${upstream} has ${commits(status.behind)} newer than the checkout (${status.branch})` : "";
  const described = (tone: ServerCheckoutDescription["tone"], text: string): ServerCheckoutDescription => ({
    tone,
    text: [running, text].filter(Boolean).join(" "),
  });

  if (checkout.restartMode === "development") {
    return described("info", `This development server restarts onto its checkout as it is.${moved}`);
  }
  if (checkout.restartMode === "off") {
    if (newer) {
      return described(
        "warning",
        `${newer}, but updating before restarts is turned off, so Restart Server loads the checkout as it is.`,
      );
    }
    return described(
      "info",
      `Updating before restarts is turned off, so Restart Server loads the checkout as it is.${moved}`,
    );
  }
  if (checkout.blocker) {
    return described("warning", `Restart Server would stop without restarting: ${checkout.blocker}`);
  }
  if (newer) {
    return described("info", `${newer}; Restart Server fast-forwards it and installs dependencies first.`);
  }
  return described(moved ? "info" : "ok", `Up to date with ${upstream}.${moved}`);
}

/** What a restart did to the checkout, for the note after it; empty when nothing is worth saying. */
export function describeServerCheckoutUpdate(update: ServerCheckoutUpdate | null | undefined): string {
  if (update?.action !== "updated") return "";
  return `The checkout (${update.status.branch}) was first fast-forwarded from ${short(update.from)} to ${short(update.status.head)}.`;
}
