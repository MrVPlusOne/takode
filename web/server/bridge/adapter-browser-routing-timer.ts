import type { BrowserUserMessage } from "./adapter-browser-routing-message-types.js";

/** Match timer reminders through exact server-owned pause wrappers without rewriting content. */
export function timerReminderMatchesSource(content: unknown, sourceId: unknown): boolean {
  if (typeof content !== "string" || typeof sourceId !== "string" || !/^timer:t[1-9]\d*$/.test(sourceId)) {
    return false;
  }
  const reminder =
    /^(?:\[Takode auto-pause resumed: (?:[2-9]|[1-9]\d+) similar automatic inputs were coalesced while delivery was paused\.\]\n\n)*\[⏰ Timer (t[1-9]\d*) reminder\]/.exec(
      content,
    );
  return reminder?.[1] === sourceId.slice("timer:".length);
}

/** Recognize an actual server-produced firing, excluding cancellation and source-only lookalikes. */
export function isTimerReminderFiring(
  message: Pick<BrowserUserMessage, "timerFiring" | "content" | "agentSource">,
): boolean {
  const firing = message.timerFiring;
  return (
    !!firing &&
    /^t[1-9]\d*$/.test(firing.timerId) &&
    Number.isSafeInteger(firing.scheduledFireAt) &&
    firing.scheduledFireAt >= 0 &&
    message.agentSource?.sessionId === `timer:${firing.timerId}` &&
    timerReminderMatchesSource(message.content, message.agentSource?.sessionId)
  );
}
