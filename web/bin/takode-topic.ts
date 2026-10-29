import type { TopicDetail, TopicListResponse, TopicRenameSuggestion, TopicSummary } from "../shared/library-topics.js";
import { nowGroupLabel } from "../shared/topic-now-items.js";
import { apiGet, apiPatch, apiPost, err, formatRelativeTime, parseFlags } from "./takode-core.js";

export const TOPIC_HELP = `Usage: takode topic <command> ...

Library topics group quests by subject, in the user's words, each with a page that a leader's
Scribe keeps current (see takode scribe). They are on only for leaders the user turned them on for;
normal work needs nothing from the leader but filing quests with --topic.

  takode topic on|off [--leader <session>]            Turn topics on or off for a leader (default:
                                                       you), when the user asks; on starts its Scribe
  takode topic list [--space <name>|all] [--json]     Topics of your space, newest first
  takode topic show <topic> [--json]                   A topic's page and quests (read it before
                                                       answering questions about the topic)
  takode topic set q-N "<topic>"                       File a quest under a topic (new name: new topic)
  takode topic set topic:<thread> "<topic>"            File a user's thread under an existing topic
  takode topic move q-N "<topic>"                      File a quest under another topic
  takode topic rename <topic> "<name>" [--reason "<why>"]
  takode topic merge <from> <into> [--fold]
  takode topic instructions <topic> "<text>"           Save the user's lasting requests for this
                                                       topic's page, such as a section to keep
                                                       (replaces them; "" clears them)

<topic> is a topic's name, or the short ID shown by list.`;

/** `takode topic ...` */
export async function handleTopic(base: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);
  const positionals = rest.filter((arg, index) => !arg.startsWith("--") && !rest[index - 1]?.startsWith("--"));
  const topicPath = (ref: string) => `/topics/${encodeURIComponent(ref)}`;
  switch (subcommand) {
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
    case "set":
    case "move": {
      const [questId, topic] = positionals;
      if (!questId || !topic) err(`Usage: takode topic ${subcommand} q-N|topic:<thread> "<topic>"`);
      // A thread (New thread) joins an existing topic; it is not a quest.
      if (questId.toLowerCase().startsWith("topic:")) {
        const result = (await apiPost(base, `/topics/threads/${encodeURIComponent(questId)}/file`, { topic })) as {
          thread: { name: string; topic?: { name: string } };
        };
        console.log(`The thread "${result.thread.name}" is filed under "${result.thread.topic?.name ?? topic}".`);
        return;
      }
      const path = subcommand === "set" ? "/topics/assign" : "/topics/move";
      const result = (await apiPost(base, path, { questId, topic })) as { topic?: TopicSummary } & TopicSummary;
      const summary = result.topic ?? result;
      console.log(
        `${questId} is under "${summary.name}" (${summary.questIds.length} quests${summary.tentative ? ", new" : ""}).`,
      );
      return;
    }
    case "on":
    case "off": {
      const leader =
        typeof flags.leader === "string"
          ? flags.leader
          : ((await apiGet(base, "/takode/me")) as { sessionId: string }).sessionId;
      const { enabled } = (await apiPost(base, `/topics/leaders/${encodeURIComponent(leader)}`, {
        enabled: subcommand === "on",
      })) as { enabled: boolean };
      console.log(
        enabled
          ? "Topics are on: its Scribe starts and sorts the leader's recent work into topics."
          : "Topics are off; the Scribe was archived.",
      );
      return;
    }
    case "rename": {
      const [ref, name] = positionals;
      if (!ref || !name) err('Usage: takode topic rename <topic> "<name>" [--reason "<why>"]');
      const result = (await apiPatch(base, topicPath(ref), {
        name,
        ...(typeof flags.reason === "string" ? { reason: flags.reason } : {}),
      })) as TopicSummary & { suggested?: TopicRenameSuggestion; skipped?: string };
      if (result.skipped) {
        console.log(`Not renamed: ${result.skipped}`);
      } else if (result.suggested) {
        console.log(
          `"${result.suggested.topicName}" was named by the user, so this is a suggestion: the user accepts or dismisses renaming it to "${result.suggested.name}" in the topics panel.`,
        );
      } else {
        console.log(`Renamed to "${result.name}".`);
      }
      return;
    }
    case "merge": {
      const [from, into] = positionals;
      if (!from || !into) err("Usage: takode topic merge <from> <into> [--fold]");
      const topic = (await apiPost(base, `${topicPath(from)}/merge`, {
        into,
        fold: flags.fold === true,
      })) as TopicSummary & { skipped?: string };
      if (topic.skipped) {
        console.log(`Not merged: ${topic.skipped}`);
        return;
      }
      console.log(
        `${flags.fold === true ? "Folded" : "Merged"} into "${topic.name}" (${topic.questIds.length} quests).`,
      );
      return;
    }
    case "instructions": {
      const [ref, text] = positionals;
      if (!ref || text === undefined)
        err('Usage: takode topic instructions <topic> "<text>"  (empty text clears them)');
      const { instructions } = (await apiPost(base, `${topicPath(ref)}/instructions`, { text })) as {
        instructions: string;
      };
      console.log(
        instructions
          ? "Saved; the Scribe keeps the page this way from its next update."
          : "Requests for this page cleared.",
      );
      return;
    }
    default:
      console.log(TOPIC_HELP);
      if (subcommand) process.exit(1);
  }
}

export function need(value: string | undefined, usage: string): string {
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
    ...(detail.instructions ? [`The user's requests for this page: "${detail.instructions}"`] : []),
    detail.upToDateAt
      ? `Page up to date as of ${new Date(detail.upToDateAt).toLocaleString()}${detail.pendingEvents ? `; ${detail.pendingEvents} newer events` : ""}:`
      : "No page yet.",
    "",
    ...(detail.now?.length
      ? [
          "## Now",
          ...detail.now.map(
            (entry) => `- ${nowGroupLabel(entry)}: ${entry.text}${entry.doneAt ? " (marked done)" : ""}`,
          ),
          "",
        ]
      : []),
    detail.page ?? "",
  ].join("\n");
}
