import { apiGet, apiPost, err, formatInlineText, parseFlags } from "./takode-core.js";

export const TRACK_HELP = `Usage: takode track <list|show|add|close> ...

A track is a named line of work in a repository: an integration branch that workers
start from and land into, kept current with the branch it follows (usually main).
Spawn workers onto it with \`takode spawn --track <name>\`; they port into it as a
remote-backed target, so landing, the landing queue and delivery recording work as usual.

  list [--closed] [--json]
      Open tracks with their branch, owner, workers and how far behind the followed branch.
  show <name> [--json]
      One track in detail, including its checkout path and machine.
  add <name> --repo <path> --branch <branch> [--follows <branch>] [--create] [--json]
      Leaders: declare a track in the repository at <path> on your machine. Takode keeps a
      checkout of <branch> for it (an existing checkout of the branch is used as it is).
      --follows defaults to the repository's default branch; --create starts <branch>
      from it when the branch exists neither locally nor on origin.
  close <name> [--json]
      The declaring leader ends the track. The branch is kept; Takode's own checkout of it
      is removed when clean and unused.

Keep a track current by merging the followed branch into it (never rebase it), as an
ordinary quest; \`list\` shows when it has fallen behind. Any leader may spawn onto a track.
`;

export interface TrackStatus {
  behind?: number | null;
  lastCommitAt?: number | null;
  fetchError?: string;
  unavailable?: string;
}

export interface TrackSummary {
  name: string;
  repo: string;
  branch: string;
  follows: string;
  owner: number | null;
  machine: string;
  workers: { sessionNum: number | null; questId?: string }[];
  status?: TrackStatus;
  closedAt?: number;
  repoRoot?: string;
  checkoutPath?: string;
  hostId?: string;
}

export async function handleTrack(base: string, args: string[]): Promise<void> {
  const subcommand = args[0] && !args[0].startsWith("--") ? args[0] : "list";
  const rest = subcommand === args[0] ? args.slice(1) : args;
  const flags = parseFlags(rest);
  const name = rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined;
  const json = flags.json === true;
  const print = (value: unknown, text: () => void) => (json ? console.log(JSON.stringify(value, null, 2)) : text());

  if (subcommand === "list") {
    const response = (await apiGet(base, `/takode/tracks${flags.closed ? "?closed=1" : ""}`)) as {
      tracks: TrackSummary[];
    };
    return print(response, () => {
      if (response.tracks.length === 0) console.log("No tracks. Declare one with takode track add <name> ...");
      for (const track of response.tracks) console.log(formatTrackLine(track));
    });
  }
  if (subcommand === "show") {
    if (!name) err("Usage: takode track show <name>");
    const { track } = (await apiGet(base, `/takode/tracks/${encodeURIComponent(name)}`)) as { track: TrackSummary };
    return print({ track }, () => printTrackDetail(track));
  }
  if (subcommand === "add") {
    if (!name) err(TRACK_HELP);
    if (typeof flags.repo !== "string" || typeof flags.branch !== "string")
      err("--repo <path> and --branch <branch> are required");
    const { track } = (await apiPost(base, "/takode/tracks", {
      name,
      repo: flags.repo,
      branch: flags.branch,
      ...(typeof flags.follows === "string" ? { follows: flags.follows } : {}),
      ...(flags.create === true ? { create: true } : {}),
    })) as { track: TrackSummary };
    return print({ track }, () => {
      console.log(`Declared track ${formatInlineText(track.name)}.`);
      printTrackDetail(track);
      console.log(`Spawn workers onto it with: takode spawn --track ${track.name} ...`);
    });
  }
  if (subcommand === "close") {
    if (!name) err("Usage: takode track close <name>");
    const response = (await apiPost(base, `/takode/tracks/${encodeURIComponent(name)}/close`, {})) as {
      track: TrackSummary;
      keptCheckout?: string;
    };
    return print(response, () => {
      console.log(
        `Closed track ${formatInlineText(response.track.name)}; branch ${formatInlineText(response.track.branch)} is kept.`,
      );
      if (response.keptCheckout) {
        console.log(
          `Its checkout ${formatInlineText(response.track.checkoutPath ?? "")} was kept: ${formatInlineText(response.keptCheckout)}`,
        );
      }
    });
  }
  err(TRACK_HELP);
}

/** One line per track: what a leader needs to pick a track and see whether it needs attention. */
export function formatTrackLine(track: TrackSummary, now = Date.now()): string {
  const owner = track.owner === null ? "owner gone" : `owner #${track.owner}`;
  const workers = track.workers.length
    ? `; workers ${track.workers.map((worker) => `#${worker.sessionNum ?? "?"}${worker.questId ? ` ${worker.questId}` : ""}`).join(", ")}`
    : "";
  const closed = track.closedAt ? "; closed" : "";
  const status = track.status ? `; ${formatTrackStatus(track, now)}` : "";
  return `${track.name}  ${track.repo}:${track.branch}  ${owner}${status}${workers}${closed}`;
}

/** How far behind its followed branch the track is, and when it last moved. */
export function formatTrackStatus(track: Pick<TrackSummary, "follows" | "status">, now = Date.now()): string {
  const status = track.status;
  if (!status) return "";
  if (status.unavailable) return `status unknown (${status.unavailable})`;
  const behind =
    status.behind === null || status.behind === undefined
      ? `${track.follows} unknown`
      : status.behind === 0
        ? `up to date with ${track.follows}`
        : `${status.behind} behind ${track.follows}`;
  const last = status.lastCommitAt ? `, last commit ${formatAge(now - status.lastCommitAt)} ago` : "";
  const stale = status.fetchError ? " (remote not reachable; last fetched state)" : "";
  return `${behind}${last}${stale}`;
}

function printTrackDetail(track: TrackSummary): void {
  console.log(formatTrackLine(track));
  console.log(`  checkout: ${formatInlineText(track.checkoutPath ?? "")} on ${formatInlineText(track.machine)}`);
}

function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * What `takode spawn --track <name>` needs: the track checkout to start from, its
 * machine, and the port target that makes the worker land into the track. The
 * checkout is first brought up to what has landed.
 */
export async function resolveTrackForSpawn(
  base: string,
  name: string,
): Promise<{ track: TrackSummary; portTarget: Record<string, unknown>; warning?: string }> {
  const { track } = (await apiGet(base, `/takode/tracks/${encodeURIComponent(name)}`)) as { track: TrackSummary };
  const pulled = (await apiPost(base, `/takode/tracks/${encodeURIComponent(track.name)}/pull`, {})) as {
    warning?: string;
  };
  return {
    track,
    portTarget: {
      repoRoot: track.repoRoot,
      branch: track.branch,
      worktreePath: track.checkoutPath,
      ...(track.hostId ? { hostId: track.hostId } : {}),
      track: track.name,
      sourceLabel: `track ${track.name}`,
    },
    ...(pulled.warning ? { warning: pulled.warning } : {}),
  };
}

/** Tracks in a worker's repository, for the reminder after a spawn without --track. */
export async function tracksInRepo(base: string, repoRoot: string | undefined): Promise<TrackSummary[]> {
  if (!repoRoot) return [];
  try {
    const query = `status=0&repoRoot=${encodeURIComponent(repoRoot)}`;
    return ((await apiGet(base, `/takode/tracks?${query}`)) as { tracks: TrackSummary[] }).tracks;
  } catch {
    // The reminder is a convenience; an older server without tracks just gets none.
    return [];
  }
}

/** Refuse spawn options that would contradict the track's checkout, machine or role. */
export function assertTrackSpawnFlags(flags: Record<string, unknown>): void {
  const clashing = ["cwd", "host", "no-worktree", "reviewer", "leader"].filter((flag) => flags[flag] !== undefined);
  if (clashing.length > 0) {
    err(`--track sets the worker's checkout and machine; drop ${clashing.map((flag) => `--${flag}`).join(", ")}.`);
  }
}

/**
 * The line spawn prints after the session summary: where the chosen track
 * stands, or a reminder when the worker's repository has tracks and none was chosen.
 */
export async function spawnTrackNote(
  base: string,
  trackSpawn: { track: TrackSummary; warning?: string } | undefined,
  repoRoot: string | undefined,
): Promise<string | null> {
  if (trackSpawn) {
    const warning = trackSpawn.warning ? `\n  Warning: ${trackSpawn.warning}; the worker starts from it as it is.` : "";
    return `Track ${trackSpawn.track.name}: ${trackSpawn.track.branch}, ${formatTrackStatus(trackSpawn.track)}${warning}`;
  }
  const tracks = await tracksInRepo(base, repoRoot);
  if (tracks.length === 0) return null;
  const names = tracks.map((track) => `${track.name} (${track.branch})`).join(", ");
  return `Note: this repository has tracks: ${names}. Work meant to land on one should spawn with --track <name>.`;
}
