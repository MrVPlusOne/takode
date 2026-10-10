import type { ServerCheckoutStatus, ServerCheckoutUpdate } from "./api/server-restart.js";

export interface ServerCheckoutDescription {
  /** `warning`: a restart would load older code than the server's branch has. */
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
 * Restart Server will load. Null when the server does not run from Git.
 */
export function describeServerCheckout(status: ServerCheckoutStatus | null): ServerCheckoutDescription | null {
  if (!status || status.state === "not-git") return null;
  const running = status.runningCommit ? `Running ${short(status.runningCommit)}.` : "";
  const moved =
    status.runningCommit && status.head && status.runningCommit !== status.head
      ? ` The checkout is at ${short(status.head)}, which a restart loads.`
      : "";
  const branch = `the checkout (${status.branch})`;
  const upstream = status.upstream ?? "its branch";
  const fetchNote = status.fetchError
    ? ` Could not fetch ${upstream} (${status.fetchError.split("\n")[0]}), so this compares with the last fetched state.`
    : "";
  const described = (tone: ServerCheckoutDescription["tone"], text: string): ServerCheckoutDescription => ({
    tone: fetchNote ? "warning" : tone,
    text: [running, text].filter(Boolean).join(" ") + fetchNote,
  });

  switch (status.state) {
    case "detached":
      return described("info", `The checkout is not on a branch, so Restart Server loads it as it is.${moved}`);
    case "no-upstream":
      return described(
        "info",
        `The checkout's branch ${status.branch} tracks no remote branch, so Restart Server loads it as it is.${moved}`,
      );
    case "current":
      return described(moved ? "info" : "ok", `Up to date with ${upstream}.${moved}`);
    case "ahead":
      return described("info", `${capitalize(branch)} has ${commits(status.ahead)} not on ${upstream}.${moved}`);
    case "behind":
      if (status.localChanges) {
        return described(
          "warning",
          `${upstream} has ${commits(status.behind)} newer than ${branch}, but it has uncommitted changes, so Restart Server leaves it alone and restarts onto older code. Commit or discard the changes first.`,
        );
      }
      return described(
        "info",
        `${upstream} has ${commits(status.behind)} newer than ${branch}; Restart Server fast-forwards the checkout first.`,
      );
    case "diverged":
      return described(
        "warning",
        `${capitalize(branch)} has ${commits(status.ahead)} not on ${upstream} and lacks ${commits(status.behind)} from it, so Restart Server cannot fast-forward it and restarts onto older code. Merge or rebase it first.`,
      );
  }
}

/** What a restart did to the checkout, for the note after it; empty when nothing is worth saying. */
export function describeServerCheckoutUpdate(update: ServerCheckoutUpdate | null | undefined): string {
  if (!update) return "";
  const { status } = update;
  if (update.action === "updated") {
    return `The checkout (${status.branch}) was first fast-forwarded from ${short(update.from)} to ${short(status.head)}.`;
  }
  if (update.action === "failed") {
    return `Could not fast-forward the checkout (${status.branch}): ${update.error ?? "unknown error"}. The server runs older code than ${status.upstream ?? "its branch"}.`;
  }
  if (status.behind > 0) {
    return `The checkout (${status.branch}) is ${commits(status.behind)} behind ${status.upstream ?? "its branch"} and was left as it is, so the server runs older code.`;
  }
  return "";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
