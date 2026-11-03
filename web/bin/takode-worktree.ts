import { resolve } from "node:path";
import { apiGet, apiPost, err, formatInlineText, getCallerSessionId, parseFlags } from "./takode-core.js";

export const WORKTREE_HELP = `Usage: takode worktree <register|unregister|list|retry> ...

Session-associated auxiliary checkout retention; Git branches are preserved.

  register <path> --retention temporary|retained [--base <local-branch>] [--host <machine>] [--json]
      Register/update your own auxiliary checkout. Temporary requires --base.
      Use retained for shared or long-running checkouts; registration does not create one.
      --host names the machine the checkout is on (default: your session's machine), for
      example one made with takode exec; give its absolute path there. Checks and cleanup run there.
  unregister <path> [--host <machine>] [--session <session>] [--json]
      Drop a registration, such as one for a checkout you already removed. Files are not touched.
      Default: your own session; a leader may name a worker it leads with --session.
  list [--session <session>] [--json]
      Show auxiliary registrations and cleanup outcomes (default: your session),
      marking checkouts whose path no longer exists (unknown while their machine is offline).
  retry <path> --session <session> [--host <machine>] [--json]
      Leader-only selected retry for an archived session's temporary checkout.
      Refuses changed identity, shared use, dirty/unmerged work, or Git failure.
`;

interface Registration {
  sessionId: string;
  machine: string;
  pathState?: "present" | "missing" | "unknown" | null;
  path: string;
  branch: string | null;
  retention: "temporary" | "retained";
  cleanupStatus: string | null;
  cleanupReason: string | null;
}

function print(record: Registration): void {
  console.log(
    `${formatInlineText(record.machine)}:${formatInlineText(record.path)}  ${record.retention}  ${record.cleanupStatus ?? "registered"}`,
  );
  console.log(`  branch=${formatInlineText(record.branch ?? "detached")} (preserved)`);
  if (record.pathState === "missing")
    console.log("  path no longer exists (unregister it, or archive cleanup drops it)");
  if (record.pathState === "unknown") console.log("  path not checked: its machine is offline");
  if (record.cleanupReason) console.log(`  reason=${formatInlineText(record.cleanupReason)}`);
}

export async function handleWorktree(base: string, args: string[]): Promise<void> {
  const subcommand = args[0] || "list";
  const flags = parseFlags(args.slice(subcommand === "list" ? 1 : 2));
  const session = typeof flags.session === "string" ? flags.session : getCallerSessionId();
  const endpoint = `/sessions/${encodeURIComponent(session)}/worktrees`;
  if (subcommand === "list") {
    const response = (await apiGet(base, endpoint)) as { worktrees: Registration[] };
    if (flags.json) console.log(JSON.stringify(response, null, 2));
    else {
      console.log(`Auxiliary worktrees: ${response.worktrees.length}`);
      for (const record of response.worktrees) print(record);
    }
    return;
  }
  if (subcommand !== "register" && subcommand !== "unregister" && subcommand !== "retry") err(WORKTREE_HELP);
  if (!args[1] || args[1].startsWith("--")) err(WORKTREE_HELP);
  if (subcommand === "register" && flags.session) err("Registration is for your own session; omit --session");
  if (subcommand === "register" && flags.retention !== "temporary" && flags.retention !== "retained")
    err("Explicit --retention temporary|retained is required");
  const host = typeof flags.host === "string" ? flags.host : undefined;
  const route = { register: endpoint, unregister: `${endpoint}/unregister`, retry: `${endpoint}/cleanup` }[subcommand];
  const response = (await apiPost(base, route, {
    // A path on another machine is taken as given: this machine's working folder means nothing there.
    path: host ? args[1] : resolve(args[1]),
    ...(host ? { host } : {}),
    ...(subcommand === "register" ? { retention: flags.retention, baseBranch: flags.base } : {}),
  })) as { worktree: Registration };
  if (flags.json) console.log(JSON.stringify(response, null, 2));
  else if (subcommand === "unregister") {
    console.log(
      `Unregistered ${formatInlineText(response.worktree.machine)}:${formatInlineText(response.worktree.path)}`,
    );
  } else print(response.worktree);
}
