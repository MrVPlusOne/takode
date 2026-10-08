import { useEffect } from "react";
import { useStore } from "../../store.js";
import type { SessionNotification } from "../../types.js";
import { MarkdownContent } from "../MarkdownContent.js";

const DEMO_SESSION_ID = "playground-notification-link-worker";

const DEMO_NOTIFICATIONS: SessionNotification[] = [
  {
    id: "n-3",
    category: "needs-input",
    summary: "Approve the staged rollout?",
    questions: [{ prompt: "Roll out to all regions?" }, { prompt: "Keep the old flag for a week?" }],
    timestamp: Date.now() - 300_000,
    messageId: null,
    threadKey: "main",
    done: false,
  },
  {
    id: "n-4",
    category: "needs-input",
    summary: "Pick a cache eviction policy",
    timestamp: Date.now() - 200_000,
    messageId: null,
    threadKey: "main",
    done: false,
    muted: true,
    snoozedUntil: Date.now() + 3_600_000,
  },
  {
    id: "n-2",
    category: "needs-input",
    summary: "Rename the settings group?",
    timestamp: Date.now() - 900_000,
    messageId: null,
    threadKey: "main",
    done: true,
  },
];

/** Notification links in prose: hover shows the prompt and its status; click opens the card's thread. */
export function PlaygroundNotificationLinkDemo() {
  // Other Playground sections replace sdkSessions when they mount, so re-seed whenever the demo session goes missing.
  const seeded = useStore(
    (state) =>
      state.sessionNotifications.has(DEMO_SESSION_ID) &&
      state.sdkSessions.some((session) => session.sessionId === DEMO_SESSION_ID),
  );
  useEffect(() => {
    if (seeded) return;
    useStore.setState((state) => {
      const sdkSessions = state.sdkSessions.some((session) => session.sessionId === DEMO_SESSION_ID)
        ? state.sdkSessions
        : [
            ...state.sdkSessions,
            {
              sessionId: DEMO_SESSION_ID,
              state: "connected" as const,
              cwd: "/Users/stan/Dev/takode",
              createdAt: Date.now() - 120_000,
              sessionNum: 5791,
              name: "Rollout Worker",
            },
          ];
      const sessionNotifications = new Map(state.sessionNotifications);
      sessionNotifications.set(DEMO_SESSION_ID, DEMO_NOTIFICATIONS);
      return { sdkSessions, sessionNotifications };
    });
  }, [seeded]);

  return (
    <MarkdownContent text="Waiting on [the rollout question](session:5791:notification:3) (open), [the eviction policy](session:5791:notification:4) (snoozed) and [the settings rename](session:5791:notification:2) (answered). A link to a missing session renders muted: [old question](session:9999:notification:1)." />
  );
}
