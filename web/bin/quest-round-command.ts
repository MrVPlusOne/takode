import type { QuestmasterTask } from "../server/quest-types.js";
import type { QuestServerClient } from "./quest-server-client.js";

export interface QuestRoundCommandDeps {
  positional: (index: number) => string | undefined;
  validateFlags: (allowed: string[]) => void;
  option: (name: string) => string | undefined;
  readRichText: (args: { inlineFlag: string; fileFlag: string; label: string }) => Promise<string | undefined>;
  questServer: QuestServerClient;
  /** Posts a status change through the guarded transition route. */
  postTransition: (questId: string, body: Record<string, unknown>) => Promise<QuestmasterTask>;
  /** Set for direct Codex tasks, which have no rounds. */
  directCodex: boolean;
  jsonOutput: boolean;
  out: (data: unknown) => void;
  die: (message: string) => never;
}

const REOPEN_USAGE =
  'Usage: quest reopen <questId> --title "..." [--brief "..." | --brief-file <path>|-] [--requests "81,84"] [--json]';
const ROUND_EDIT_USAGE =
  'Usage: quest round edit <questId> <number> [--title "..."] [--brief "..." | --brief-file <path>|-] [--json]';

/**
 * `quest reopen`: close the quest's current round and open the next one with
 * its own title, brief and the feedback that asked for it, then return the
 * quest to `refined` for the leader to dispatch, as `quest transition` did.
 */
export async function runReopenCommand(deps: QuestRoundCommandDeps): Promise<void> {
  deps.validateFlags(["title", "brief", "brief-file", "requests", "json"]);
  const id = deps.positional(0);
  const title = deps.option("title")?.trim();
  if (!id || !title) deps.die(REOPEN_USAGE);
  if (deps.directCodex) deps.die("Direct Codex tasks have no rounds; use `quest transition` instead.");
  const brief = await deps.readRichText({ inlineFlag: "brief", fileFlag: "brief-file", label: "Round brief" });
  const requests = parseRequests(deps.option("requests"), deps.die);
  const quest = await deps.postTransition(id, {
    status: "refined",
    openRound: { title, ...(brief !== undefined ? { brief } : {}), ...(requests.length ? { requests } : {}) },
  });
  if (deps.jsonOutput) return deps.out(quest);
  console.log(`Reopened ${quest.questId} for round ${quest.rounds?.length ?? "?"}: ${title}`);
}

/** `quest round edit`: retitle a round or rewrite its brief. */
export async function runRoundCommand(deps: QuestRoundCommandDeps): Promise<void> {
  if (deps.positional(0) !== "edit") deps.die(ROUND_EDIT_USAGE);
  deps.validateFlags(["title", "brief", "brief-file", "json"]);
  const id = deps.positional(1);
  const number = Number(deps.positional(2));
  if (!id || !Number.isInteger(number) || number < 1) deps.die(ROUND_EDIT_USAGE);
  const title = deps.option("title");
  const brief = await deps.readRichText({ inlineFlag: "brief", fileFlag: "brief-file", label: "Round brief" });
  if (title === undefined && brief === undefined) deps.die(ROUND_EDIT_USAGE);
  const { value: quest } = await deps.questServer.request<QuestmasterTask>(
    "PATCH",
    `/quests/${encodeURIComponent(id)}`,
    { round: { number, ...(title !== undefined ? { title } : {}), ...(brief !== undefined ? { brief } : {}) } },
  );
  if (deps.jsonOutput) return deps.out(quest);
  console.log(`Updated round ${number} of ${quest.questId}`);
}

function parseRequests(raw: string | undefined, die: (message: string) => never): number[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((part) => {
    const value = Number(part.trim().replace(/^#/, ""));
    if (!Number.isInteger(value) || value < 0) die(`--requests takes feedback indices such as 81,84; got "${part}"`);
    return value;
  });
}
