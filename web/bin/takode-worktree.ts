import { resolve } from "node:path";
import { apiGet, apiPost, err, formatInlineText, getCallerSessionId, parseFlags } from "./takode-core.js";

export const WORKTREE_HELP = `Usage: takode worktree <register|list|retry> ...

Session-associated auxiliary checkout retention; Git branches are preserved.

  register <path> --retention temporary|retained [--base <local-branch>] [--json]
      Register/update your own auxiliary checkout. Temporary requires --base.
      Use retained for shared or long-running checkouts; registration does not create one.
  list [--session <session>] [--json]
      Show auxiliary registrations and cleanup outcomes (default: your session).
  retry <path> --session <session> [--json]
      Leader-only selected retry for an archived session's temporary checkout.
      Refuses changed identity, shared use, dirty/unmerged work, or Git failure.
`;

interface Registration {
  sessionId: string;
  path: string;
  branch: string | null;
  retention: "temporary" | "retained";
  cleanupStatus: string | null;
  cleanupReason: string | null;
}

function print(record: Registration): void {
  console.log(`${formatInlineText(record.path)}  ${record.retention}  ${record.cleanupStatus ?? "registered"}`);
  console.log(`  branch=${formatInlineText(record.branch ?? "detached")} (preserved)`);
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
  if (subcommand !== "register" && subcommand !== "retry") err(WORKTREE_HELP);
  if (!args[1] || args[1].startsWith("--")) err(WORKTREE_HELP);
  if (subcommand === "register" && flags.session) err("Registration is for your own session; omit --session");
  if (subcommand === "register" && flags.retention !== "temporary" && flags.retention !== "retained")
    err("Explicit --retention temporary|retained is required");
  const response = (await apiPost(base, subcommand === "retry" ? `${endpoint}/cleanup` : endpoint, {
    path: resolve(args[1]),
    ...(subcommand === "register" ? { retention: flags.retention, baseBranch: flags.base } : {}),
  })) as { worktree: Registration };
  if (flags.json) console.log(JSON.stringify(response, null, 2));
  else print(response.worktree);
}
