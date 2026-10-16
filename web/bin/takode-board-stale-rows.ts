import { apiPost, assertKnownFlags, err, parseFlags } from "./takode-core.js";

export const BOARD_RM_HELP = `Usage: takode board rm <quest-id> [<quest-id> ...] [--full|--verbose] [--json]
       takode board rm <quest-id> --leader <session> --reason <text> [--json]

Remove one or more quests from the active board.

With --leader, remove a stale row from another leader's board instead. That
leader must be paused or archived, since it cannot clean up its own board. The
row moves to its board history with your reason; its pause and held input stay
as they are. Rows on paused or archived leaders already never block running
leaders, so use this to clear one that is obsolete.
`;

/** `takode board rm q-N --leader <session> --reason <text>`: clear another stopped leader's stale row. */
export async function handleStaleBoardRowRemoval(base: string, args: string[]): Promise<void> {
  const questId = args[0];
  if (!questId || !/^q-\d+$/.test(questId)) err(BOARD_RM_HELP);
  const flags = parseFlags(args.slice(1));
  assertKnownFlags(flags, new Set(["leader", "reason", "json"]), BOARD_RM_HELP);
  if (typeof flags.leader !== "string") err("--leader requires the paused or archived leader's session.");
  if (typeof flags.reason !== "string" || !flags.reason.trim()) err("--reason <text> is required.");
  const leaderRef = flags.leader.replace(/^#/, "");
  const result = (await apiPost(
    base,
    `/sessions/${encodeURIComponent(leaderRef)}/board/${encodeURIComponent(questId)}/remove-stale`,
    { reason: flags.reason },
  )) as { leaderSessionId: string; leaderSessionNum: number | null; removed: { questId: string; status?: string } };
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const leader = result.leaderSessionNum !== null ? `#${result.leaderSessionNum}` : result.leaderSessionId;
  const state = result.removed.status ? ` (was ${result.removed.status})` : "";
  console.log(`Removed ${result.removed.questId}${state} from ${leader}'s board; it is in that board's history.`);
}
