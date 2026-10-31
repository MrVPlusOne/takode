import type { TopicEvent } from "../shared/library-topics.js";

/**
 * The messages Takode sends a Scribe by itself: start initialization, what changed since the last
 * message, a reminder when it stopped before finishing, and the notice its leader gets when even
 * the reminder didn't help. Each is built from data, so it says exactly what happened.
 */

export interface LeaderLabel {
  sessionNum: number | null;
  name: string;
}

export interface TopicChanges {
  name: string;
  id: string;
  events: TopicEvent[];
}

export interface UpdateContent {
  topics: TopicChanges[];
  /** The leader's quests created since the last message that have no topic yet. */
  unsorted: Array<{ questId: string; title: string }>;
  /** Threads the user started that just settled under no topic: file each where it plainly belongs. */
  settledThreads?: Array<{ key: string; name: string; startedFrom?: string; firstMessage?: string }>;
  /** The user's instructions for topics and pages, when they changed since this Scribe was last told. */
  instructions?: string;
  /** Topics the user asked to update now (Update now). */
  forced: string[];
  /**
   * The user's messages to other leaders since the last message: something a page says is open
   * may have been handled there. They don't make a message go by themselves.
   */
  elsewhere?: Array<{ sessionNum: number | null; at: number; index: number; threadKey: string; text: string }>;
  /** The page format changed since the Scribe wrote its pages: rewrite them all, once. */
  rewritePages?: boolean;
  /** Topics the leader started since the last message: check each is distinct enough. */
  newTopics?: Array<{ id: string; name: string; questIds: string[] }>;
  /** The leader has more topics than the soft target: merge the quietest that plainly belong elsewhere. */
  consolidate?: {
    count: number;
    target: number;
    /** Quietest first: the leader's quests filed since the topic's last activity, then fewest quests. */
    quiet: Array<{ id: string; name: string; quests: number; questsSince: number }>;
  };
}

const MAX_EVENTS_PER_TOPIC = 8;
const MAX_UNSORTED = 20;

export function initializationMessage(leader: LeaderLabel, instructions: string | undefined): string {
  return [
    `Start initialization for your leader ${label(leader)}: sort its recent work into topics and write each topic's page, as the Initialization part of your brief describes.`,
    ...(instructions ? ["", `The user's instructions: "${instructions}"`] : []),
  ].join("\n");
}

/** What changed for the leader since the Scribe's last message; null when nothing did. */
export function updateMessage(
  leader: LeaderLabel,
  content: UpdateContent,
  sessionNum: (sessionId: string) => number | null,
): string | null {
  const { topics, unsorted, instructions, forced, rewritePages, consolidate } = content;
  const settledThreads = content.settledThreads ?? [];
  const newTopics = content.newTopics ?? [];
  if (
    !topics.length &&
    !unsorted.length &&
    !settledThreads.length &&
    !instructions &&
    !forced.length &&
    !rewritePages &&
    !newTopics.length &&
    !consolidate
  ) {
    return null;
  }
  const lines = [`What changed for your leader ${label(leader)} since my last message:`];
  if (rewritePages) {
    lines.push(
      "",
      "Your brief changed, and this asks for one change on each of your leader's topics (`takode topic list` lists them); change nothing else. The Now lists are retired: they went stale and asked the user to tick items off. For each topic, run `takode scribe changes <topic>`, then write where it stands with `takode scribe stands <topic>`: one to three short lines on what is open or waiting now, folding in whatever of its old Now entries (listed there) is still open and true; leave out what a quest or Takode already shows. Then remove History lines that only restate a finished quest (Takode lists finished quests in a quest log) and save the page; if its History has none, mark it `--unchanged`. Then order your leader's overview (`takode scribe overview`).",
    );
  }
  if (instructions) lines.push("", `The user's instructions changed: "${instructions}"`);
  if (forced.length) lines.push("", `The user asked to update now: ${forced.map((name) => `"${name}"`).join(", ")}`);
  const elsewhere = content.elsewhere ?? [];
  if (elsewhere.length) {
    lines.push(
      "",
      "What the user told other leaders meanwhile (it may settle something a page says is open: then rewrite that line):",
    );
    for (const message of elsewhere) {
      const time = new Date(message.at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const num = message.sessionNum ?? "?";
      lines.push(
        `- ${time} · to #${num} in ${message.threadKey} ([message](session:${num}:${message.index})): "${message.text}"`,
      );
    }
  }
  for (const topic of topics) {
    lines.push("", `"${topic.name}" (${topic.id.slice(0, 8)}):`);
    for (const event of topic.events.slice(-MAX_EVENTS_PER_TOPIC)) lines.push(`- ${describeEvent(event, sessionNum)}`);
    const hidden = topic.events.length - MAX_EVENTS_PER_TOPIC;
    if (hidden > 0) lines.push(`- and ${hidden} earlier (\`takode scribe changes ${topic.id.slice(0, 8)}\`)`);
  }
  if (settledThreads.length) {
    lines.push(
      "",
      'Threads the user started that settled (their last answer was read) under no topic: file each under the topic it plainly belongs to (`takode topic set <thread> "<topic>"`; `takode topic list` shows the topics), or leave it unfiled; never make a topic for a thread:',
    );
    for (const thread of settledThreads) {
      lines.push(`- ${thread.key} "${thread.name}"${thread.startedFrom ? `, started from ${thread.startedFrom}` : ""}`);
      if (thread.firstMessage) lines.push(`  It began: "${thread.firstMessage.replace(/\s+/g, " ")}"`);
    }
  }
  if (newTopics.length) {
    lines.push(
      "",
      "Your leader started new topics. Check each is a distinct subject, one the user would look for apart from every other topic. If it isn't, merge it into the topic it plainly belongs to (`takode topic merge <new> <topic> --fold`); never widen a topic to take it in. If no topic fits, keep it.",
    );
    for (const topic of newTopics) {
      lines.push(`- "${topic.name}" (${topic.id.slice(0, 8)}), with ${topic.questIds.join(", ") || "no quests yet"}`);
    }
  }
  if (consolidate) {
    lines.push(
      "",
      `Your leader has ${consolidate.count} topics, more than the soft target of ${consolidate.target} (or the range in the user's instructions). Merge quiet topics into the topic each plainly belongs to until it is back near the target, quietest first; leave a topic that has no such home as it is. Never stretch a topic into a generic one to take others in: keep every topic distinct, so the user can tell where a new quest goes; split or rename instead when that keeps them clearer. Quietest topics (quests your leader filed since the topic's last activity; quests in the topic):`,
    );
    for (const topic of consolidate.quiet) {
      lines.push(`- "${topic.name}" (${topic.id.slice(0, 8)}): ${topic.questsSince} since, ${topic.quests} in it`);
    }
  }
  if (unsorted.length) {
    lines.push("", "New quests with no topic:");
    for (const quest of unsorted.slice(0, MAX_UNSORTED)) lines.push(`- ${quest.questId} ${quest.title}`);
    if (unsorted.length > MAX_UNSORTED) lines.push(`- and ${unsorted.length - MAX_UNSORTED} more`);
  }
  lines.push(
    "",
    "Update what these touch: where each topic stands (`takode scribe stands`) and its page. `takode scribe changes <topic>` shows a page with everything not on it yet. Then order your leader's overview (`takode scribe overview`), and tell your leader about loose ends if there are any (`takode scribe loose-ends`).",
  );
  return lines.join("\n");
}

/** The reminder after the Scribe stopped with work of the last message left. */
export function reminderMessage(left: string[]): string {
  return [
    "You stopped before finishing what my last message asked for:",
    ...left.map((item) => `- ${item}`),
    "",
    "Finish these. If nothing on a page needs to change, mark its events read with `takode scribe write-page <topic> --unchanged`. If something stops you, tell your leader with `takode notify needs-input`.",
  ].join("\n");
}

/** The last message again, after the turn that took it was interrupted or failed. */
export function retryMessage(text: string): string {
  return `Your last turn was interrupted or failed before you finished, so here is my last message again:\n\n${text}`;
}

/** For the leader: loose ends its Scribe noticed, one line each, for the leader to act on or ask about. */
export function looseEndsNotice(scribeNum: number | null, lines: readonly string[]): string {
  return [
    `Your Scribe #${scribeNum ?? "?"} noticed loose ends:`,
    ...lines.map((line) => `- ${line}`),
    "",
    "Act on them or ask the user; skip any that are already handled. You need not reply to the Scribe.",
  ].join("\n");
}

/** For the leader, once, when its Scribe's turns keep failing (often its login or the model service). */
export function failureNotice(scribeNum: number | null, failures: number, retryAt: number): string {
  const scribe = `#${scribeNum ?? "?"}`;
  const at = new Date(retryAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return [
    `Your Scribe ${scribe}'s last ${failures} turns failed, so Takode stopped sending it page updates. It tries again later, waiting longer each time up to 30 minutes (next at ${at}), and resumes as soon as a turn finishes.`,
    `Turns that fail at once usually mean its backend can't run (an expired login, an outage): look with \`takode peek ${scribeNum ?? "<scribe>"}\`, and tell the user if it needs them.`,
  ].join("\n");
}

/** For the leader, when its Scribe stopped again after the reminder. */
export function leaderNotice(scribeNum: number | null, left: string[]): string {
  const scribe = `#${scribeNum ?? "?"}`;
  return [
    `Your Scribe ${scribe} stopped twice, after a reminder, without finishing its topic pages:`,
    ...left.map((item) => `- ${item}`),
    "",
    `Look at what it did (\`takode peek ${scribeNum ?? "<scribe>"}\`) and steer it with \`takode send\`, or tell the user if it needs them.`,
  ].join("\n");
}

function describeEvent(event: TopicEvent, sessionNum: (sessionId: string) => number | null): string {
  const time = new Date(event.at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const num = event.sessionId ? sessionNum(event.sessionId) : null;
  const link =
    num !== null && event.messageIndex !== undefined ? ` ([message](session:${num}:${event.messageIndex}))` : "";
  const quest = event.questId ?? "";
  const text = event.text ?? "";
  switch (event.kind) {
    case "message":
      if (!quest) return `${time} · the user wrote in the topic's conversation${link}: "${text}"`;
      return `${time} · the user wrote in ${quest}${link}: "${text}"`;
    case "quest_filed":
      return `${time} · ${quest} was put under this topic${text ? `: ${text}` : ""}`;
    case "quest_done":
      return `${time} · ${quest} finished: ${text}`;
    case "artifact":
      return `${time} · ${text} was saved in ${quest || "the topic's conversation"}`;
    case "undone":
      return `${time} · ${text}`;
    case "check":
      return `${time} · in ${quest}, a check for the user was ticked: "${text}"`;
    case "note":
      return `${time} · note on ${quest}: "${text}"`;
    case "now_done":
    case "page_request":
    case "picture":
      return `${time} · ${text}`;
  }
}

function label(leader: LeaderLabel): string {
  return `#${leader.sessionNum ?? "?"} "${leader.name}"`;
}
