import {
  apiGet,
  apiPost,
  assertKnownFlags,
  err,
  formatInlineText,
  formatTime,
  getCredentials,
  parseFlags,
  readStdinText,
} from "./takode-core.js";

/** Server record of a message queued for a session that was not running (server/message-delivery-tracker.ts). */
export interface MessageDelivery {
  id: string;
  status: "pending" | "queued" | "delivered" | "failed";
  reason?: string;
  queuedAt: number;
  settledAt?: number;
  followUp: boolean;
}

const POLL_MS = 1_000;
/** The server ends `pending` after its 20 s wait window; this only guards against a server that never does. */
const MAX_WAIT_MS = 40_000;

export async function handleSend(base: string, args: string[]): Promise<void> {
  const sessionRef = args[0];
  const usage =
    "Usage: takode send <session> <message> [--correction] [--json]\n       takode send <session> --stdin [--correction] [--json]";
  const flags = parseFlags(args.slice(1));
  assertKnownFlags(flags, new Set(["json", "correction", "stdin"]), usage);

  const jsonMode = flags.json === true;
  const isCorrection = flags.correction === true;
  const useStdin = flags.stdin === true;

  const messageParts = args.slice(1).filter((arg) => arg !== "--json" && arg !== "--correction" && arg !== "--stdin");

  if (!sessionRef) err(usage);
  if (useStdin && messageParts.length > 0) {
    err("Cannot combine --stdin with a positional message.");
  }

  const cleanContent = useStdin ? await readStdinText() : messageParts.join(" ");

  if (!cleanContent.trim()) err(usage);

  // Guard: orchestrators can only send to herded sessions or other leaders
  const callerSessionId = getCredentials()?.sessionId;
  if (callerSessionId) {
    try {
      // Resolve target to a full UUID
      const targetSession = (await apiGet(base, `/sessions/${encodeURIComponent(sessionRef)}`)) as {
        sessionId: string;
        sessionNum?: number;
        name?: string;
        isGenerating?: boolean;
        archived?: boolean;
        isOrchestrator?: boolean;
      };
      const targetId = targetSession.sessionId;
      if (targetSession.archived) {
        const label = targetSession.name
          ? `#${targetSession.sessionNum ?? "?"} ${targetSession.name}`
          : `#${targetSession.sessionNum ?? sessionRef}`;
        err(`Cannot send to archived session ${label}.`);
      }

      // A peer leader is never herded and is usually mid-turn, so messages to it
      // skip the busy-session guard and herd check. The server accepts them only from leaders.
      const isPeerLeader = targetSession.isOrchestrator === true && targetId !== callerSessionId;

      // Guard: block sends to running sessions unless --correction is used
      if (!isPeerLeader && targetSession.isGenerating && !isCorrection) {
        const label = targetSession.name
          ? `#${targetSession.sessionNum ?? "?"} ${targetSession.name}`
          : `#${targetSession.sessionNum ?? sessionRef}`;
        err(
          `Session ${label} is currently working. ` +
            `Queue this task and send it after the session finishes. ` +
            `Use "takode send ${sessionRef} <message> --correction" if this is a steering message for the current task.`,
        );
      }

      // Check herd membership
      if (!isPeerLeader) {
        const herdList = (await apiGet(base, `/sessions/${encodeURIComponent(callerSessionId)}/herd`)) as Array<{
          sessionId: string;
        }>;
        if (!herdList.some((s) => s.sessionId === targetId)) {
          err(`Cannot send to session ${sessionRef} — not in your herd. Run \`takode herd ${sessionRef}\` first.`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // If error is from our own guards (herd check, running check), re-throw
      if (msg.includes("not in your herd") || msg.includes("currently working") || msg.includes("archived session")) {
        throw e;
      }
      // Other errors (session not found, etc.) — let the send call handle it
    }
  }

  // Identify the calling session so the receiver can show an agent badge
  let agentSource: { sessionId: string; sessionLabel?: string } | undefined;
  if (callerSessionId) {
    let sessionLabel: string | undefined;
    try {
      const sessions = (await apiGet(base, "/takode/sessions")) as Array<{
        sessionId: string;
        sessionNum?: number;
        name?: string;
      }>;
      const own = sessions.find((s) => s.sessionId === callerSessionId);
      if (own) {
        sessionLabel = own.name
          ? `#${own.sessionNum ?? "?"} ${own.name}`
          : `#${own.sessionNum ?? callerSessionId.slice(0, 8)}`;
      }
    } catch {
      // Non-critical — send without label
    }
    agentSource = { sessionId: callerSessionId, ...(sessionLabel ? { sessionLabel } : {}) };
  }

  const result = (await apiPost(base, `/sessions/${encodeURIComponent(sessionRef)}/message`, {
    content: cleanContent,
    ...(agentSource ? { agentSource } : {}),
    trackDelivery: true,
  })) as { delivery?: string; paused?: boolean; diagnostic?: string; messageDelivery?: MessageDelivery };
  if (result.messageDelivery) result.messageDelivery = await awaitDelivery(base, result.messageDelivery);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const target = formatInlineText(sessionRef);
  if (result.paused) {
    console.log(
      `[${formatTime(Date.now())}] ✓ Message held for paused session ${target}. ${
        result.diagnostic ?? "Unpause to resume delivery."
      }`,
    );
  } else if (result.delivery === "dropped") {
    console.log(`[${formatTime(Date.now())}] ✗ Session ${target} did not accept the message.`);
    process.exitCode = 1;
  } else {
    printDelivery(`Message to session ${target}`, result.delivery, result.messageDelivery);
  }
}

/** Poll a queued message until the server's short wait window gives a definite answer or ends. */
export async function awaitDelivery(base: string, delivery: MessageDelivery): Promise<MessageDelivery> {
  const giveUpAt = Date.now() + MAX_WAIT_MS;
  let current = delivery;
  while (current.status === "pending" && Date.now() < giveUpAt) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    current = (await apiGet(base, `/takode/messages/${encodeURIComponent(current.id)}`)) as MessageDelivery;
  }
  return current;
}

/** Print what happened to a message; a failed delivery sets a non-zero exit code. */
export function printDelivery(
  subject: string,
  delivery: string | undefined,
  tracked: MessageDelivery | undefined,
): void {
  const time = `[${formatTime(Date.now())}]`;
  if (!tracked) {
    // Older servers do not track queued messages, so "queued" is all that is known.
    const note =
      delivery === "queued" ? " queued; the session is not running, so it is not delivered yet" : " delivered";
    console.log(`${time} ${delivery === "queued" ? "…" : "✓"} ${subject}${note}`);
    return;
  }
  const reason = formatInlineText(tracked.reason ?? "unknown reason");
  if (tracked.status === "delivered") {
    const waited = Math.max(1, Math.round(((tracked.settledAt ?? tracked.queuedAt) - tracked.queuedAt) / 1000));
    console.log(`${time} ✓ ${subject} delivered after the session started (${waited}s)`);
  } else if (tracked.status === "failed") {
    const later = tracked.followUp ? "; you will get a message_delivery herd event if it is delivered later" : "";
    console.log(`${time} ✗ ${subject} NOT delivered: ${reason}. It stays queued there${later}. (${tracked.id})`);
    process.exitCode = 1;
  } else {
    const later = tracked.followUp ? " You will get a message_delivery herd event when it is delivered or fails." : "";
    console.log(`${time} … ${subject} queued, NOT delivered yet: ${reason}.${later} (${tracked.id})`);
  }
}
