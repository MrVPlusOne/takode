import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { useStore } from "../../store.js";
import type { ChatMessage, SessionNotification } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";

const SESSION = "playground-needs-input-history";
const NOTIFICATION = "n-history";
const modes = ["Unanswered", "Answered", "Missing response", "Handled"] as const;
type Mode = (typeof modes)[number];
const question = "Should the rollout begin after review, or wait until tomorrow?";
const response = "After review.\n\nKeep the canary in place until the smoke checks finish.";
const source: ChatMessage = {
  id: "decision",
  role: "assistant",
  content: "The canary is healthy. Choose when to continue the rollout.",
  timestamp: 10,
};
const command: ChatMessage = {
  id: "notify-command",
  role: "assistant",
  content: "",
  timestamp: 20,
  contentBlocks: [
    {
      type: "tool_use",
      id: "notify-tool",
      name: "Bash",
      input: { command: 'takode notify needs-input "Choose rollout timing"' },
    },
  ],
};

/** Fixture-only notifications and replies; actions never touch real sessions. */
export function PlaygroundNeedsInputHistory() {
  const [mode, setMode] = useState<Mode>("Answered");
  const [replyContent, setReplyContent] = useState(response);
  useEffect(() => {
    const previous = useStore.getState().sessionNotifications.get(SESSION);
    return () => {
      useStore.setState((state) => {
        const sessionNotifications = new Map(state.sessionNotifications);
        if (previous) sessionNotifications.set(SESSION, previous);
        else sessionNotifications.delete(SESSION);
        return { sessionNotifications };
      });
    };
  }, []);
  useEffect(() => {
    const notification: SessionNotification = {
      id: NOTIFICATION,
      category: "needs-input",
      messageId: source.id,
      timestamp: 20,
      summary: "Choose rollout timing",
      questions: [{ prompt: question, suggestedAnswers: ["After review", "Tomorrow"] }],
      done: mode !== "Unanswered",
      ...(mode !== "Unanswered"
        ? {
            resolutionNotice: {
              source: mode === "Handled" ? ("manual" as const) : ("response" as const),
              status: "delivered" as const,
              resolvedAt: 30,
            },
          }
        : {}),
    };
    useStore.setState((state) => ({
      sessionNotifications: new Map(state.sessionNotifications).set(SESSION, [notification]),
    }));
    const originalReplies = api.getNotificationReplies;
    const originalSend = api.sendNeedsInputResponse;
    const originalDone = api.markNotificationDone;
    const replies: typeof originalReplies = async (sessionId, id) =>
      sessionId === SESSION
        ? { replies: mode === "Answered" ? [{ content: replyContent }] : [] }
        : originalReplies(sessionId, id);
    const send: typeof originalSend = async (sessionId, id, body) => {
      if (sessionId !== SESSION) return originalSend(sessionId, id, body);
      setReplyContent(body.content);
      setMode("Answered");
      return { ok: true, sessionId, notificationId: id, delivery: "sent" };
    };
    const done: typeof originalDone = async (sessionId, id, value) => {
      if (sessionId !== SESSION) return originalDone(sessionId, id, value);
      setMode(value ? "Handled" : "Unanswered");
      return { ok: true };
    };
    api.getNotificationReplies = replies;
    api.sendNeedsInputResponse = send;
    api.markNotificationDone = done;
    return () => {
      if (api.getNotificationReplies === replies) api.getNotificationReplies = originalReplies;
      if (api.sendNeedsInputResponse === send) api.sendNeedsInputResponse = originalSend;
      if (api.markNotificationDone === done) api.markNotificationDone = originalDone;
    };
  }, [mode, replyContent]);

  return (
    <div className="space-y-3" data-testid="playground-needs-input-history">
      <div className="flex flex-wrap gap-2">
        {modes.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className="min-h-11 rounded border border-cc-border px-2 text-xs aria-pressed:bg-cc-hover cursor-pointer"
          >
            {value}
          </button>
        ))}
      </div>
      <div key={mode}>
        <MessageBubble message={source} sessionId={SESSION} showTimestamp={false} />
        <MessageBubble message={command} sessionId={SESSION} showTimestamp={false} />
      </div>
    </div>
  );
}
