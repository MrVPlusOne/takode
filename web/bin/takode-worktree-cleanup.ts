import { apiGet, err, formatInlineText, formatTimestampCompact, parseFlags, takodeAuthHeaders } from "./takode-core.js";

export const WORKTREE_CLEANUP_HELP = `Usage: takode worktree-cleanup <list|retry> ...

Discover and retry cleanup for archived Takode-owned worktrees.

Subcommands:
  list [--all] [--json]       List archived worktree cleanup candidates
  retry <session> [--json]    Retry cleanup for one archived worktree session
`;

type CleanupStatus = "pending" | "done" | "failed";

interface WorktreeCleanupCandidate {
  sessionId: string;
  sessionNum: number | null;
  name: string | null;
  archivedAt: number | null;
  repoRoot: string;
  branch: string;
  actualBranch: string | null;
  worktreePath: string;
  cleanupStatus: CleanupStatus | null;
  cleanupError: string | null;
  exists: boolean;
  inUseBy: string[];
  retryable: boolean;
  owned: boolean;
  ownershipReason: string;
  safety: { status: "not_checked" | "blocked"; summary: string };
}

interface WorktreeCleanupListResponse {
  candidates: WorktreeCleanupCandidate[];
}

interface WorktreeCleanupRetryResponse {
  ok?: boolean;
  error?: string;
  cleanup?: { status: CleanupStatus; path?: string };
  candidate?: WorktreeCleanupCandidate;
  safety?: { status: string; summary: string; reason?: string; dirty?: boolean; committedAhead?: number };
}

function sessionLabel(candidate: WorktreeCleanupCandidate): string {
  const num = candidate.sessionNum !== null ? `#${candidate.sessionNum}` : candidate.sessionId.slice(0, 8);
  return candidate.name ? `${num} ${candidate.name}` : num;
}

function repoLabel(candidate: WorktreeCleanupCandidate): string {
  return candidate.repoRoot.replace(/\/+$/, "").split("/").pop() || candidate.repoRoot;
}

function cleanupStatus(candidate: WorktreeCleanupCandidate): string {
  if (candidate.cleanupStatus === "pending") return "pending";
  if (candidate.cleanupStatus === "failed") return "failed";
  if (!candidate.exists) return "gone";
  return candidate.cleanupStatus ?? "preserved";
}

function printCandidate(candidate: WorktreeCleanupCandidate): void {
  const status = cleanupStatus(candidate);
  const retry = candidate.retryable ? "retryable" : "blocked";
  const archived = candidate.archivedAt ? ` archived=${formatTimestampCompact(candidate.archivedAt)}` : "";
  console.log(`${formatInlineText(sessionLabel(candidate))}  ${status}  ${retry}${archived}`);
  console.log(`  repo=${formatInlineText(repoLabel(candidate))}  branch=${formatInlineText(candidate.branch)}`);
  console.log(`  path=${formatInlineText(candidate.worktreePath)}`);
  console.log(
    `  exists=${candidate.exists ? "yes" : "no"}  in-use=${candidate.inUseBy.length ? candidate.inUseBy.join(",") : "no"}  safety=${formatInlineText(candidate.safety.summary)}`,
  );
  if (candidate.cleanupError) console.log(`  error=${formatInlineText(candidate.cleanupError)}`);
}

async function postRetry(
  base: string,
  sessionRef: string,
): Promise<{ status: number; body: WorktreeCleanupRetryResponse }> {
  const res = await fetch(`${base}/worktree-cleanup/${encodeURIComponent(sessionRef)}/retry`, {
    method: "POST",
    headers: takodeAuthHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  const body = (await res.json().catch(() => ({ error: res.statusText }))) as WorktreeCleanupRetryResponse;
  return { status: res.status, body };
}

export async function handleWorktreeCleanup(base: string, args: string[]): Promise<void> {
  const subcommand = args[0] || "list";
  if (subcommand === "list") {
    const flags = parseFlags(args.slice(1));
    const jsonMode = flags.json === true;
    const includeAll = flags.all === true;
    const response = (await apiGet(
      base,
      `/worktree-cleanup/candidates${includeAll ? "?all=1" : ""}`,
    )) as WorktreeCleanupListResponse;

    if (jsonMode) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    if (response.candidates.length === 0) {
      console.log("No archived worktree cleanup candidates.");
      return;
    }

    console.log(`Archived worktree cleanup candidates: ${response.candidates.length}`);
    for (const candidate of response.candidates) {
      printCandidate(candidate);
    }
    console.log("Retry: takode worktree-cleanup retry <session>");
    return;
  }

  if (subcommand === "retry") {
    const sessionRef = args.filter((arg) => !arg.startsWith("--"))[1];
    const flags = parseFlags(args.slice(2));
    const jsonMode = flags.json === true;
    if (!sessionRef) err("Usage: takode worktree-cleanup retry <session> [--json]");

    const { status, body } = await postRetry(base, sessionRef);
    if (jsonMode) {
      console.log(JSON.stringify(body, null, 2));
      if (status >= 400) process.exit(1);
      return;
    }

    if (status >= 400 || !body.ok) {
      console.log(
        `Worktree cleanup retry refused for ${formatInlineText(sessionRef)}: ${body.error || "unknown error"}`,
      );
      if (body.safety?.summary) console.log(`  safety=${formatInlineText(body.safety.summary)}`);
      if (body.candidate) printCandidate(body.candidate);
      process.exit(1);
    }

    const candidate = body.candidate;
    console.log(
      `[${formatTimestampCompact(Date.now())}] ✓ Queued worktree cleanup retry for ${formatInlineText(sessionRef)}`,
    );
    if (candidate) {
      console.log(`  path=${formatInlineText(candidate.worktreePath)}`);
      console.log(`  safety=${formatInlineText(body.safety?.summary || "safe to retry cleanup")}`);
    }
    return;
  }

  err(`Unknown worktree-cleanup subcommand: ${subcommand}. Use list or retry.`);
}
