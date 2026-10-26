import type { ScribeOverview, TopicRenameSuggestion } from "../shared/library-topics.js";
import { type NowEntry, nowGroupLabel } from "../shared/topic-now-items.js";
import { formatArtifactLink } from "../shared/artifact-library.js";
import { parseActivityTime } from "./takode-activity.js";
import { apiDelete, apiGet, apiPatch, apiPost, err, parseFlags, readOptionTextFile } from "./takode-core.js";
import { need } from "./takode-topic.js";

export const SCRIBE_HELP = `Usage: takode scribe <command> ...

A leader with Library topics on has a Scribe: a special worker in its herd that keeps the topic
pages from that leader's activity. Takode sends it what changed by itself; its routine turns don't
reach the leader, and it speaks up only when it needs the leader. It never takes quest work. To
steer it beyond these commands, message it: takode send <its session> "...".

For leaders:
  takode scribe status [--leader <session>] [--json]   What your Scribe is doing, the user's
                                                       instructions, renames waiting
  takode scribe instructions "<text>"                  Set the user's lasting instructions for topics
                                                       and pages (replaces them; "" clears them)
  takode scribe pause | resume                         Stop or restart automatic page updates

For the Scribe:
  takode scribe brief                                  Your brief
  takode scribe changes <topic>                        The page and your leader's events since your
                                                       last write
  takode scribe write-page <topic> --file <path>|-     Save the whole page
  takode scribe write-page <topic> --unchanged         Nothing on the page needs to change: mark
                                                       what changes showed as read
  takode scribe now add <topic> --group <group> [--who "<who>"] [--due YYYY-MM-DD] "<text>"
                                                       Add a Now entry for your leader's work; groups:
                                                       waiting (needs --who), progress, next, followup, try
  takode scribe now edit <topic> <id> [--group <group>] [--who "<who>"] [--due YYYY-MM-DD] ["<text>"]
  takode scribe now remove <topic> <id>                It is done or no longer matters
  takode scribe quests [--unsorted] [--since 30d]      Your leader's recent quests (--unsorted: those
                                                       with no topic yet)

Topics themselves (list, show, set, move, rename, merge): takode topic.`;

/** `takode scribe ...` */
export async function handleScribe(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);
  const positionals = rest.filter((arg, index) => !arg.startsWith("--") && !rest[index - 1]?.startsWith("--"));
  const pagePath = (ref: string) => `/scribe/topics/${encodeURIComponent(ref)}`;
  const leaderQuery = typeof flags.leader === "string" ? `?leader=${encodeURIComponent(flags.leader)}` : "";
  switch (subcommand) {
    case "status": {
      const status = (await apiGet(base, `/scribe/status${leaderQuery}`)) as ScribeStatusResponse;
      if (flags.json === true) console.log(JSON.stringify(status, null, 2));
      else console.log(formatScribeStatus(status));
      return;
    }
    case "now": {
      console.log(await handleNow(base, positionals, flags, pagePath));
      return;
    }
    case "instructions": {
      const text = positionals[0];
      if (text === undefined) err('Usage: takode scribe instructions "<text>"  (empty text clears them)');
      const { leader } = (await apiGet(base, `/scribe/status${leaderQuery}`)) as ScribeStatusResponse;
      const { instructions } = (await apiPost(base, `/scribe/${encodeURIComponent(leader.sessionId)}/instructions`, {
        text,
      })) as { instructions: string };
      console.log(
        instructions ? "Instructions saved; the Scribe follows them from its next update." : "Instructions cleared.",
      );
      return;
    }
    case "pause":
    case "resume": {
      const { leader } = (await apiGet(base, `/scribe/status${leaderQuery}`)) as ScribeStatusResponse;
      await apiPost(base, `/scribe/${encodeURIComponent(leader.sessionId)}/pause`, { paused: subcommand === "pause" });
      console.log(
        subcommand === "pause"
          ? "Paused: pages wait until the user asks for an update or you resume."
          : "Resumed: the Scribe catches up on what waited.",
      );
      return;
    }
    case "brief": {
      const { brief } = (await apiGet(base, "/scribe/brief", { auth: "optional" })) as { brief: string };
      console.log(brief);
      return;
    }
    case "changes": {
      const ref = need(positionals[0], "takode scribe changes <topic>");
      console.log(formatChanges((await apiGet(base, `${pagePath(ref)}/changes`)) as TopicChangesResponse));
      return;
    }
    case "write-page": {
      const usage = "takode scribe write-page <topic> --file <path>|- (or --unchanged)";
      const ref = need(positionals[0], usage);
      if (flags.unchanged === true) {
        const detail = (await apiPost(base, `${pagePath(ref)}/page`, { unchanged: true })) as { name: string };
        console.log(`Marked what changed on "${detail.name}" as read; the page stays as it is.`);
        return;
      }
      if (typeof flags.file !== "string") err(`Usage: ${usage}`);
      const markdown = await readOptionTextFile(flags.file, "--file");
      const detail = (await apiPost(base, `${pagePath(ref)}/page`, { markdown })) as {
        name: string;
        warnings?: string[];
      };
      console.log(`Saved the page of "${detail.name}" (${markdown.length} characters).`);
      for (const warning of detail.warnings ?? []) console.log(`Warning: ${warning}`);
      return;
    }
    case "quests": {
      const params = new URLSearchParams(typeof flags.leader === "string" ? { leader: flags.leader } : {});
      if (flags.unsorted === true) params.set("unsorted", "1");
      if (typeof flags.since === "string") params.set("since", String(parseActivityTime(flags.since, Date.now())));
      const { quests } = (await apiGet(base, `/scribe/quests?${params}`)) as {
        quests: Array<{
          questId: string;
          title: string;
          status: string;
          createdAt: number;
          tldr: string;
          topic: string | null;
        }>;
      };
      if (quests.length === 0) console.log("No quests.");
      for (const quest of quests) {
        console.log(
          `${quest.questId}  ${quest.status}  ${new Date(quest.createdAt).toISOString().slice(0, 10)}  ${quest.title}${quest.topic ? `  [${quest.topic}]` : ""}${quest.tldr ? `\n    ${quest.tldr}` : ""}`,
        );
      }
      return;
    }
    default:
      console.log(SCRIBE_HELP);
      if (subcommand) process.exit(1);
  }
}

export interface ScribeStatusResponse {
  leader: { sessionId: string; sessionNum: number | null; space: string | null };
  enabled: boolean;
  topics: number;
  scribe: ScribeOverview;
  suggestions: TopicRenameSuggestion[];
}

/** A few lines: on or off, what the Scribe is doing, the instructions, and renames waiting for the user. */
export function formatScribeStatus(status: ScribeStatusResponse): string {
  const leader = `#${status.leader.sessionNum ?? "?"}`;
  if (!status.enabled)
    return `Topics are off for ${leader}, so it has no Scribe; the user turns topics on in the topics panel.`;
  const { activity, paused, instructions } = status.scribe;
  const scribe = activity.sessionNum != null ? `#${activity.sessionNum}` : "not started";
  const lines = [
    `Topics for ${leader} (space ${status.leader.space ?? "?"}): ${status.topics} topic${status.topics === 1 ? "" : "s"}`,
    `Scribe ${scribe}: ${activity.text}${paused ? " (paused)" : ""}`,
    `Instructions: ${instructions ? `"${instructions}"` : "none"}`,
  ];
  for (const suggestion of status.suggestions) {
    lines.push(`Waiting for the user: rename "${suggestion.topicName}" to "${suggestion.name}"`);
  }
  return lines.join("\n");
}

interface TopicChangesResponse {
  topic: { id: string; name: string; space: string; nameSource: string; tentative: boolean };
  page: string | null;
  upToDateAt: number | null;
  /** The user's lasting instructions for all the leader's topics. */
  instructions?: string;
  /** The user's lasting requests for this topic's page. */
  pageRequests?: string;
  now: Array<NowEntry & { yours: boolean }>;
  events: Array<{
    at: number;
    kind: string;
    questId?: string;
    sessionNum?: number | null;
    messageIndex?: number;
    text?: string;
  }>;
  quests: Array<{
    questId: string;
    title: string;
    status: string;
    completedAt?: number;
    checksLeft?: string[];
    wrapUp?: string;
  }>;
  artifacts: Array<{ id: string; kind: string; title: string; versions: number; questId: string; updatedAt: number }>;
}

function formatChanges(response: TopicChangesResponse): string {
  const { topic } = response;
  const lines = [
    `Topic "${topic.name}" (${topic.id.slice(0, 8)}, space ${topic.space}${topic.nameSource === "user" ? ", named by the user" : ""}${topic.tentative ? ", new" : ""})`,
    "",
    ...(response.pageRequests ? ["## The user's requests for this page (follow them)", response.pageRequests, ""] : []),
    ...(response.instructions
      ? ["## The user's instructions for all topics (follow them)", response.instructions, ""]
      : []),
    "## Quests (what each left open is the source for Now)",
    ...response.quests.flatMap((quest) => [
      `- [${quest.questId}](quest:${quest.questId}) ${quest.completedAt ? `done ${new Date(quest.completedAt).toLocaleDateString()}` : quest.status}: ${quest.title}`,
      ...(quest.checksLeft ?? []).map((check) => `  - Left for the user (unticked): ${check}`),
      ...(quest.wrapUp ? [`  - Wrap-up: ${quest.wrapUp.replace(/\s*\n\s*/g, " ")}`] : []),
    ]),
    "",
    `## What happened since your last write (${response.events.length})`,
    ...response.events.map((event) => {
      const when = new Date(event.at).toLocaleString();
      const link =
        event.sessionNum != null && event.messageIndex !== undefined
          ? ` (session:${event.sessionNum}:${event.messageIndex})`
          : "";
      return `- ${when} · ${event.kind}${event.questId ? ` · ${event.questId}` : ""}${link}${event.text ? ` · ${event.text}` : ""}`;
    }),
    "",
    "## Artifacts made in these quests",
    ...(response.artifacts.length
      ? response.artifacts.map(
          (artifact) =>
            `- ${formatArtifactLink(artifact.title, artifact.id)} (${artifact.kind}${artifact.versions > 1 ? `, ${artifact.versions} versions` : ""}, ${artifact.questId}, ${new Date(artifact.updatedAt).toLocaleDateString()})`,
        )
      : ["- none"]),
    "",
    "## Now (entries; change them with `takode scribe now`)",
    ...(response.now.length ? response.now.map(formatNowEntry) : ["- none"]),
    "",
    "## Current page",
    response.page ?? "(no page yet)",
  ];
  return lines.join("\n");
}

function formatNowEntry(entry: TopicChangesResponse["now"][number]): string {
  const facts = [
    entry.yours ? "" : `from leader #${entry.leaderNum ?? "?"}`,
    entry.due ? `due ${entry.due}` : "",
    entry.doneAt ? "the user marked it done" : "",
    `since ${new Date(entry.since).toLocaleDateString()}`,
  ].filter(Boolean);
  return `- ${entry.id} · ${nowGroupLabel(entry)}: ${entry.text} (${facts.join(", ")})`;
}

/** `takode scribe now add|edit|remove`: one line saying what changed. */
async function handleNow(
  base: string,
  positionals: string[],
  flags: Record<string, string | boolean>,
  pagePath: (ref: string) => string,
): Promise<string> {
  const [action, topic, ...more] = positionals;
  const usage = "takode scribe now add|edit|remove <topic> ... (see takode scribe --help)";
  if (!topic) err(`Usage: ${usage}`);
  const fields = {
    ...(typeof flags.group === "string" ? { group: flags.group } : {}),
    ...(typeof flags.who === "string" ? { who: flags.who } : {}),
    ...(typeof flags.due === "string" ? { due: flags.due } : {}),
  };
  if (action === "add") {
    const entry = (await apiPost(base, `${pagePath(topic)}/now`, { ...fields, text: more.join(" ") })) as NowEntry;
    return `Added ${entry.id} under ${nowGroupLabel(entry)}.`;
  }
  const id = more[0];
  if (!id) err(`Usage: ${usage}`);
  if (action === "edit") {
    const text = more.slice(1).join(" ");
    const entry = (await apiPatch(base, `${pagePath(topic)}/now/${encodeURIComponent(id)}`, {
      ...fields,
      ...(text ? { text } : {}),
    })) as NowEntry;
    return `Updated ${entry.id} (${nowGroupLabel(entry)}).`;
  }
  if (action === "remove") {
    await apiDelete(base, `${pagePath(topic)}/now/${encodeURIComponent(id)}`);
    return `Removed ${id}.`;
  }
  return err(`Usage: ${usage}`);
}
