import { isCanonicalLeaderUserMessageId } from "../shared/leader-user-message-id.ts";
import { normalizeThreadTarget } from "../shared/thread-routing.ts";
import { apiPost, err, getCallerSessionId } from "./takode-core.js";

export const THREAD_HANDOFF_HELP = `Usage: takode thread handoff <quest-id|topic:<handle>> --user <uN> [more-ids...] [--notification <n-N> ...] [--json]

Transfer selected pending requests to an active quest: from Main (with their exact existing decision
notifications) or from a topic's thread. Main requests can also go to a topic's thread.
--user is required. IDs accept lists, comma-separated values, and repeated flags.
User IDs must use uN; notification IDs must use n-N, with positive integers and no leading zeros.
Same-destination retries make no changes. Original source history is preserved.
This transfers responsibility; thread attach only organizes prior context.
`;

interface ThreadHandoffResult {
  ok: boolean;
  sessionId: string;
  questId: string;
  handedOffUserMessageIds: string[];
  alreadyHandedOffUserMessageIds: string[];
  notificationIds: string[];
  alreadyHandedOffNotificationIds: string[];
}

/** Transfer explicitly selected Main obligations using the caller's authenticated session. */
export async function handleThreadHandoff(base: string, args: string[]): Promise<void> {
  const { json, ...body } = parseHandoffArgs(args);
  const selfId = getCallerSessionId();
  const result = (await apiPost(
    base,
    `/sessions/${encodeURIComponent(selfId)}/thread/handoff`,
    body,
  )) as ThreadHandoffResult;

  if (json) {
    // Keep unexpected backend diagnostics or source payloads out of the public command output.
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          sessionId: result.sessionId,
          questId: result.questId,
          handedOffUserMessageIds: result.handedOffUserMessageIds,
          alreadyHandedOffUserMessageIds: result.alreadyHandedOffUserMessageIds,
          notificationIds: result.notificationIds,
          alreadyHandedOffNotificationIds: result.alreadyHandedOffNotificationIds,
        },
        null,
        2,
      ),
    );
    return;
  }

  const changed = formatHandoffIds(result.handedOffUserMessageIds, result.notificationIds);
  const unchanged = formatHandoffIds(result.alreadyHandedOffUserMessageIds, result.alreadyHandedOffNotificationIds);
  const summary = changed ? `Handed off to ${result.questId}: ${changed}.` : `No changes for ${result.questId}.`;
  console.log(`${summary}${unchanged ? ` Already handed off: ${unchanged}.` : ""}`);
}

function parseHandoffArgs(args: string[]): {
  questId: string;
  userMessageIds: string[];
  notificationIds?: string[];
  json: boolean;
} {
  const raw = args[0]?.trim().toLowerCase();
  if (!raw) err(THREAD_HANDOFF_HELP.trim());
  const target = normalizeThreadTarget(raw);
  if (!target || target.threadKey === "main") {
    err(`Invalid destination "${raw}": give a quest ID (q-42) or a topic thread (topic:8df94bcb)`);
  }
  const questId = target.threadKey;

  const userMessageIds = new Set<string>();
  const notificationIds = new Set<string>();
  let json = false;
  let index = 1;
  while (index < args.length) {
    const flag = args[index++];
    if (flag === "--json") {
      json = true;
      continue;
    }
    if (flag !== "--user" && flag !== "--notification") {
      err(`Unknown option or argument: ${flag}\n${THREAD_HANDOFF_HELP.trim()}`);
    }
    const values: string[] = [];
    while (index < args.length && !args[index].startsWith("-")) {
      values.push(...args[index++].split(",").map((value) => value.trim()));
    }
    if (values.length === 0) err(`${flag} requires at least one ${flag === "--user" ? "uN" : "n-N"} ID.`);
    for (const value of values) {
      if (flag === "--user") {
        if (!isCanonicalLeaderUserMessageId(value)) err(`Invalid user ID "${value}": use uN (e.g., u1, u42).`);
        userMessageIds.add(value);
      } else {
        if (!/^n-[1-9]\d*$/.test(value)) err(`Invalid notification ID "${value}": use n-N (e.g., n-1, n-42).`);
        notificationIds.add(value);
      }
    }
  }
  if (userMessageIds.size === 0) err("--user requires at least one uN ID.");
  return {
    questId,
    userMessageIds: [...userMessageIds],
    ...(notificationIds.size > 0 ? { notificationIds: [...notificationIds] } : {}),
    json,
  };
}

function formatHandoffIds(userMessageIds: string[], notificationIds: string[]): string {
  return [userMessageIds.join(", "), notificationIds.length > 0 ? `notifications ${notificationIds.join(", ")}` : ""]
    .filter(Boolean)
    .join("; ");
}
