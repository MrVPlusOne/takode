import type { TopicDetail, TopicListResponse, TopicSummary } from "../shared/library-topics.js";
import { parseActivityTime } from "./takode-activity.js";
import { apiGet, apiPatch, apiPost, err, formatRelativeTime, parseFlags, readOptionTextFile } from "./takode-core.js";

export const TOPIC_HELP = `Usage: takode topic <command> ...

Library topics group a leader's quests by subject, in the user's words, each with a page kept
current from the conversations. They are on only for leaders the user turned them on for.

  takode topic list [--space <name>|all] [--json]     Topics of your space, newest first
  takode topic show <topic> [--json]                   A topic's page and quests (read it before
                                                       answering questions about the topic)
  takode topic set q-N "<topic>"                       File a quest under a topic (new name: new topic)
  takode topic move q-N "<topic>"                      File a quest under another topic
  takode topic rename <topic> "<name>"
  takode topic merge <from> <into> [--fold]

For the page writer:
  takode topic guide                                   How to write topic pages
  takode topic changes <topic>                         The page and what happened since it was written
  takode topic write-page <topic> --file <path>|-
  takode topic quests --leader <session> [--unfiled] [--since 30d]

<topic> is a topic's name, or the short ID shown by list.`;

/** `takode topic ...` */
export async function handleTopic(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);
  const positionals = rest.filter((arg, index) => !arg.startsWith("--") && !rest[index - 1]?.startsWith("--"));
  const topicPath = (ref: string) => `/topics/${encodeURIComponent(ref)}`;
  switch (subcommand) {
    case "guide": {
      const { guide } = (await apiGet(base, "/topics/guide", { auth: "optional" })) as { guide: string };
      console.log(guide);
      return;
    }
    case "list": {
      const space = typeof flags.space === "string" ? `?space=${encodeURIComponent(flags.space)}` : "";
      const response = (await apiGet(base, `/topics${space}`)) as TopicListResponse;
      if (flags.json === true) console.log(JSON.stringify(response.topics, null, 2));
      else console.log(formatTopicList(response.topics));
      return;
    }
    case "show": {
      const ref = need(positionals[0], "takode topic show <topic>");
      const detail = (await apiGet(base, topicPath(ref))) as TopicDetail;
      if (flags.json === true) console.log(JSON.stringify(detail, null, 2));
      else console.log(formatTopicDetail(detail));
      return;
    }
    case "changes": {
      const ref = need(positionals[0], "takode topic changes <topic>");
      console.log(formatChanges((await apiGet(base, `${topicPath(ref)}/changes`)) as TopicChangesResponse));
      return;
    }
    case "write-page": {
      const ref = need(positionals[0], "takode topic write-page <topic> --file <path>|-");
      if (typeof flags.file !== "string") err("Usage: takode topic write-page <topic> --file <path>|-");
      const markdown = await readOptionTextFile(flags.file, "--file");
      const detail = (await apiPost(base, `${topicPath(ref)}/page`, { markdown })) as TopicDetail;
      console.log(`Saved the page of "${detail.name}" (${markdown.length} characters).`);
      return;
    }
    case "set":
    case "move": {
      const [questId, topic] = positionals;
      if (!questId || !topic) err(`Usage: takode topic ${subcommand} q-N "<topic>"`);
      const path = subcommand === "set" ? "/topics/assign" : "/topics/move";
      const result = (await apiPost(base, path, { questId, topic })) as { topic?: TopicSummary } & TopicSummary;
      const summary = result.topic ?? result;
      console.log(
        `${questId} is under "${summary.name}" (${summary.questIds.length} quests${summary.tentative ? ", new" : ""}).`,
      );
      return;
    }
    case "rename": {
      const [ref, name] = positionals;
      if (!ref || !name) err('Usage: takode topic rename <topic> "<name>"');
      const topic = (await apiPatch(base, topicPath(ref), { name })) as TopicSummary;
      console.log(`Renamed to "${topic.name}".`);
      return;
    }
    case "merge": {
      const [from, into] = positionals;
      if (!from || !into) err("Usage: takode topic merge <from> <into> [--fold]");
      const topic = (await apiPost(base, `${topicPath(from)}/merge`, {
        into,
        fold: flags.fold === true,
      })) as TopicSummary;
      console.log(
        `${flags.fold === true ? "Folded" : "Merged"} into "${topic.name}" (${topic.questIds.length} quests).`,
      );
      return;
    }
    case "quests": {
      if (typeof flags.leader !== "string")
        err("Usage: takode topic quests --leader <session> [--unfiled] [--since 30d]");
      const params = new URLSearchParams({ leader: flags.leader });
      if (flags.unfiled === true) params.set("unfiled", "1");
      if (typeof flags.since === "string") params.set("since", String(parseActivityTime(flags.since, Date.now())));
      const { quests } = (await apiGet(base, `/topics/leader-quests?${params}`)) as {
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
      console.log(TOPIC_HELP);
      if (subcommand) process.exit(1);
  }
}

interface TopicChangesResponse {
  topic: { id: string; name: string; space: string; nameSource: string; tentative: boolean };
  page: string | null;
  upToDateAt: number | null;
  events: Array<{
    at: number;
    kind: string;
    questId?: string;
    sessionNum?: number | null;
    messageIndex?: number;
    text?: string;
  }>;
  quests: Array<{ questId: string; title: string; status: string }>;
  artifacts: Array<{ id: string; kind: string; title: string; versions: number; questId: string; updatedAt: number }>;
}

function need(value: string | undefined, usage: string): string {
  if (!value) err(`Usage: ${usage}`);
  return value;
}

export function formatTopicList(topics: TopicSummary[]): string {
  if (topics.length === 0) return "No topics.";
  return topics
    .map((topic) => {
      const flagsText = [
        topic.tentative ? "new" : "",
        topic.nameSource === "user" ? "named by the user" : "",
        topic.pendingEvents ? `${topic.pendingEvents} new events` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `${topic.id.slice(0, 8)}  ${topic.name}  · ${topic.questIds.length} quests${flagsText ? ` · ${flagsText}` : ""} · ${formatRelativeTime(topic.updatedAt)}${topic.summary ? `\n    ${topic.summary}` : ""}`;
    })
    .join("\n");
}

function formatTopicDetail(detail: TopicDetail): string {
  return [
    `${detail.name}  (${detail.id.slice(0, 8)}, space ${detail.space}${detail.tentative ? ", new" : ""})`,
    `Quests: ${detail.questIds.join(", ") || "none"}`,
    detail.upToDateAt
      ? `Page up to date as of ${new Date(detail.upToDateAt).toLocaleString()}${detail.pendingEvents ? `; ${detail.pendingEvents} newer events` : ""}:`
      : "No page yet.",
    "",
    detail.page ?? "",
  ].join("\n");
}

function formatChanges(response: TopicChangesResponse): string {
  const { topic } = response;
  const lines = [
    `Topic "${topic.name}" (${topic.id.slice(0, 8)}, space ${topic.space}${topic.nameSource === "user" ? ", named by the user" : ""}${topic.tentative ? ", new" : ""})`,
    "",
    "## Quests",
    ...response.quests.map((quest) => `- [${quest.questId}](quest:${quest.questId}) ${quest.status}: ${quest.title}`),
    "",
    `## What happened since the page was written (${response.events.length})`,
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
            `- ${artifact.title} (${artifact.kind}${artifact.versions > 1 ? `, ${artifact.versions} versions` : ""}, ${artifact.questId}, ${new Date(artifact.updatedAt).toLocaleDateString()})`,
        )
      : ["- none"]),
    "",
    "## Current page",
    response.page ?? "(no page yet)",
  ];
  return lines.join("\n");
}
