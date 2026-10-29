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
  /** The page format changed since the Scribe wrote its pages: rewrite them all, once. */
  rewritePages?: boolean;
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
  const { topics, unsorted, instructions, forced, rewritePages } = content;
  const settledThreads = content.settledThreads ?? [];
  if (
    !topics.length &&
    !unsorted.length &&
    !settledThreads.length &&
    !instructions &&
    !forced.length &&
    !rewritePages
  ) {
    return null;
  }
  const lines = [`What changed for your leader ${label(leader)} since my last message:`];
  if (rewritePages) {
    lines.push(
      "",
      "Your brief's page guidance changed. Rewrite each page of your leader's topics (`takode topic list` lists them) in the current format. For each one, run `takode scribe changes <topic>` first, then bring its Now entries in line with what its quests left open (unticked checks, wrap-ups) and with recent messages, using `takode scribe now`. Latest change: pages are dashboards that track the topic's current state, not explanations. Remove sections that explain or collect background, such as How it works, Worth knowing, Findings or People, unless the user asked for them on that page; keep the summary line, Status or Latest sections, the sections the user asked for, and History.",
    );
  }
  if (instructions) lines.push("", `The user's instructions changed: "${instructions}"`);
  if (forced.length) lines.push("", `The user asked to update now: ${forced.map((name) => `"${name}"`).join(", ")}`);
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
  if (unsorted.length) {
    lines.push("", "New quests with no topic:");
    for (const quest of unsorted.slice(0, MAX_UNSORTED)) lines.push(`- ${quest.questId} ${quest.title}`);
    if (unsorted.length > MAX_UNSORTED) lines.push(`- and ${unsorted.length - MAX_UNSORTED} more`);
  }
  lines.push(
    "",
    "Update what these touch. `takode scribe changes <topic>` shows a page with everything not on it yet.",
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
      return `${time} · ${text}`;
  }
}

function label(leader: LeaderLabel): string {
  return `#${leader.sessionNum ?? "?"} "${leader.name}"`;
}
