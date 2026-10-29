import { formatThreadMarker } from "../../shared/thread-routing.js";
import { topicOfViewForLeader } from "../topic-views.js";
import { LIBRARY_MESSAGE_SOURCE } from "../../shared/library-topics.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";
import type { BrowserUserMessage, IngestedUserMessage } from "./adapter-browser-routing-message-types.js";
import { isSystemSourceTag, isTimerReminderContent, isTimerSourceTag } from "./adapter-browser-routing-source-tags.js";
import { formatCompactAgentLabel } from "../../shared/takode-constants.js";
import { isTimerReminderFiring, timerReminderMatchesSource } from "./adapter-browser-routing-timer.js";

function localDateKey(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Session tags carry only the stable `#N`: names can be long and change on rename. */
function sourceSessionLabel(agentSource: NonNullable<BrowserUserMessage["agentSource"]>): string {
  return formatCompactAgentLabel(agentSource.sessionLabel) ?? agentSource.sessionId.slice(0, 8);
}

export function buildAdapterUserMessageSourcePrefix(
  session: AdapterBrowserRoutingSessionLike,
  ts: number,
  getLauncherSessionInfo: AdapterBrowserRoutingDeps["getLauncherSessionInfo"],
  agentSource?: BrowserUserMessage["agentSource"],
  content?: string,
  sourceThreadKey?: string,
  leaderUserMessageId?: string,
): string {
  const date = new Date(ts);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateKey = localDateKey(ts);
  const includeDate = !session.lastUserMessageDateTag || dateKey !== session.lastUserMessageDateTag;
  session.lastUserMessageDateTag = dateKey;
  const dateStr = includeDate
    ? date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " "
    : "";
  const timeWithDate = dateStr + time;
  const sessionInfo = getLauncherSessionInfo(session.id);
  const threadTag = sessionInfo?.isOrchestrator && sourceThreadKey ? `${formatThreadMarker(sourceThreadKey)} ` : "";
  if (isTimerSourceTag(agentSource)) {
    // A coalesced held firing keeps its pause wrapper ahead of the reminder line.
    return isTimerReminderContent(content) || timerReminderMatchesSource(content, agentSource?.sessionId)
      ? `[Timer reminder ${timeWithDate}] ${threadTag}`
      : `[Timer event ${timeWithDate}] ${threadTag}`;
  }
  if (sessionInfo?.isOrchestrator) {
    if (isSystemSourceTag(agentSource)) return `[System ${timeWithDate}] ${threadTag}`;
    if (agentSource?.sessionId === "herd-events") return `[Herd ${timeWithDate}] ${threadTag}`;
    if (agentSource) {
      const label = sourceSessionLabel(agentSource);
      const role = getLauncherSessionInfo(agentSource.sessionId)?.isOrchestrator ? "Leader" : "Agent";
      return `[${role} ${label} ${timeWithDate}] ${threadTag}`;
    }
    const idTag = leaderUserMessageId ? ` id:${leaderUserMessageId}` : "";
    return `[User ${timeWithDate}${idTag}] ${threadTag}${topicTag(sourceThreadKey)}`;
  }
  // Requests Takode sends a Scribe come from the Library, not from its leader.
  if (agentSource?.sessionId === LIBRARY_MESSAGE_SOURCE.sessionId) return `[Library ${timeWithDate}] `;
  if (sessionInfo?.herdedBy && agentSource) {
    const label = sourceSessionLabel(agentSource);
    return `[Leader ${label} ${timeWithDate}] `;
  }
  return `[User ${timeWithDate}] `;
}

/** Build a model envelope once, retaining the original envelope when a held firing is delivered again. */
export function buildUserMessageDeliveryPrefix(
  session: AdapterBrowserRoutingSessionLike,
  ingested: IngestedUserMessage,
  msg: BrowserUserMessage,
  contentPreview: string | undefined,
  deps: Pick<AdapterBrowserRoutingDeps, "getLauncherSessionInfo">,
): string {
  // Held firings keep their delivered content, which already starts with the
  // envelope; a reminder's own text starts with "[⏰ Timer", never "[Timer ".
  if (isTimerReminderFiring(msg) && msg.deliveryContent?.startsWith("[Timer ")) return "";
  return buildAdapterUserMessageSourcePrefix(
    session,
    ingested.timestamp,
    deps.getLauncherSessionInfo,
    msg.agentSource,
    contentPreview,
    ingested.historyEntry.threadKey,
    ingested.historyEntry.leaderUserMessageId,
  );
}

/**
 * For a message written in a topic's thread: `[topic: "<name>"; quests: q-12, q-9, …] ` after its
 * `[thread:topic:<handle>]` tag. The user wrote to the topic, not to a quest; the leader answers in
 * the topic's thread or hands the message off to one of its quests.
 */
function topicTag(threadKey: string | undefined): string {
  const topic = topicOfViewForLeader(threadKey);
  if (!topic) return "";
  const quests = [...topic.questIds, ...(topic.more ? [`${topic.more} more`] : [])].join(", ");
  // A thread the user started (New thread) is not a topic: the leader names it, may file it under
  // a topic, and starts quests from it.
  if (topic.thread) {
    const from = topic.thread.startedFrom ? `; started from ${topic.thread.startedFrom}` : "";
    const under = topic.thread.topicName ? `; filed under topic "${topic.thread.topicName}"` : "";
    return `[user thread: "${topic.name}"${from}${under}] `;
  }
  return `[topic: "${topic.name}"${quests ? `; quests: ${quests}` : ""}] `;
}
