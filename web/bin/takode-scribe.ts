import type { OverviewOrder, ScribeOverview, TopicRenameSuggestion } from "../shared/library-topics.js";
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
  takode scribe stands <topic> --file <path>|-        Where the topic stands for your leader's work:
                                                       one to three short lines, replacing the last
                                                       ones (an empty file clears them)
  takode scribe loose-ends --file <path>|-             Tell your leader about loose ends, one line
                                                       each (a few messages a day at most)
  takode scribe overview                               What your leader's overview lists now, and
                                                       your last order for it
  takode scribe overview set --file <path>|-           Save the order, most urgent first: one line
                                                       per thread, "<key> | <short note>" (the note
                                                       is optional)
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
    case "stands": {
      const usage = "takode scribe stands <topic> --file <path>|-";
      const ref = need(positionals[0], usage);
      if (typeof flags.file !== "string") err(`Usage: ${usage}`);
      const lines = lineList(await readOptionTextFile(flags.file, "--file"));
      const saved = (await apiPost(base, `${pagePath(ref)}/stands`, { lines })) as { lines: string[] };
      console.log(
        saved.lines.length ? `Saved where it stands (${saved.lines.length} lines).` : "Cleared where it stands.",
      );
      return;
    }
    case "loose-ends": {
      if (typeof flags.file !== "string") err("Usage: takode scribe loose-ends --file <path>|-");
      const lines = lineList(await readOptionTextFile(flags.file, "--file"));
      const { sent } = (await apiPost(base, `/scribe/loose-ends${leaderQuery}`, { lines })) as { sent: boolean };
      console.log(
        sent
          ? `Told your leader about ${lines.length} loose end${lines.length === 1 ? "" : "s"}.`
          : "Not sent: today's loose-ends messages are used up. Keep the rest for tomorrow if they still matter.",
      );
      return;
    }
    case "overview": {
      if (positionals[0] === "set") {
        if (typeof flags.file !== "string") err("Usage: takode scribe overview set --file <path>|-");
        const entries = parseOverviewOrder(await readOptionTextFile(flags.file, "--file"));
        const order = (await apiPost(base, `/scribe/overview${leaderQuery}`, { entries })) as OverviewOrder;
        console.log(`Saved the overview's order (${order.entries.length} lines).`);
        return;
      }
      console.log(formatOverview((await apiGet(base, `/scribe/overview${leaderQuery}`)) as ScribeOverviewResponse));
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
    return `Topics are off for ${leader}, so it has no Scribe: the user turned them off in its topics panel or for every leader in Settings.`;
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
  stands: Array<{ lines: string[]; at: number; leaderNum: number | null; yours: boolean }>;
  /** Your leader's retired Now entries, to fold into where the topic stands. */
  oldNow: string[];
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
    "## Quests",
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
    "## Where it stands (yours; replace it with `takode scribe stands`)",
    ...(response.stands.find((stand) => stand.yours)?.lines.map((line) => `- ${line}`) ?? ["- not written yet"]),
    ...response.stands
      .filter((stand) => !stand.yours)
      .flatMap((stand) => [
        ``,
        `Leader #${stand.leaderNum ?? "?"}'s Scribe wrote:`,
        ...stand.lines.map((line) => `- ${line}`),
      ]),
    ...(response.oldNow.length
      ? [
          "",
          "## Your old Now entries (retired: fold what is still open and true into where it stands; they go once you write it)",
          ...response.oldNow.map((text) => `- ${text}`),
        ]
      : []),
    "",
    "## Current page",
    response.page ?? "(no page yet)",
  ];
  return lines.join("\n");
}

interface ScribeOverviewResponse {
  items: Array<{ key: string; title?: string; questions: string[]; results: string[]; running?: string }>;
  order: OverviewOrder | null;
}

/** The overview's threads as the Scribe ranks them, then its last order. */
export function formatOverview(response: ScribeOverviewResponse): string {
  const lines = [
    "## What your leader's overview lists now",
    ...(response.items.length
      ? response.items.map((item) => {
          const facts = [
            item.running ? `running (${item.running})` : "",
            ...item.questions.map((question) => `question: "${question}"`),
            item.results.length ? `${item.results.length} unread: ${item.results.map((r) => `"${r}"`).join(", ")}` : "",
          ].filter(Boolean);
          return `- ${item.key}${item.title ? ` "${item.title}"` : ""} · ${facts.join(" · ")}`;
        })
      : ["- nothing: no questions, unread results or running quests"]),
    "",
    "## Your last order",
    ...(response.order?.entries.length
      ? [
          `(saved ${new Date(response.order.writtenAt).toLocaleString()})`,
          ...response.order.entries.map((entry) => `${entry.key}${entry.note ? ` | ${entry.note}` : ""}`),
        ]
      : ["none yet"]),
    "",
    'Save a new one with `takode scribe overview set --file -`: one line per thread, most urgent first, "<key> | <short note>".',
  ];
  return lines.join("\n");
}

/** Lines of "<key> | <note>" (or a bare key); blank lines and "#" comments are skipped. */
export function parseOverviewOrder(text: string): Array<{ key: string; note?: string }> {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^[-*] +/, ""))
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const bar = line.indexOf("|");
      const key = (bar < 0 ? line : line.slice(0, bar)).trim();
      const note = bar < 0 ? "" : line.slice(bar + 1).trim();
      return note ? { key, note } : { key };
    });
}

/** Non-empty lines of a file, without list bullets. */
export function lineList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^[-*] +/, ""))
    .filter(Boolean);
}
