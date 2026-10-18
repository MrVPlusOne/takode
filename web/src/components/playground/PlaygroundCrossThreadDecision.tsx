import { useEffect } from "react";
import { useStore } from "../../store.js";
import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";

const SESSION_ID = "playground-cross-thread-decision";
const NOTIFICATION_ID = "n-cross-thread-decision";
const CONTEXT_MESSAGE_ID = `needs-input-context-${NOTIFICATION_ID}`;
const NOOP = () => {};

/** A question asked in Main whose context answers a request from this quest tab: the card is answerable here too. */
export function PlaygroundCrossThreadDecision() {
  useEffect(() => {
    const previous = useStore.getState().sessionNotifications;
    const next = new Map(previous);
    next.set(SESSION_ID, [
      {
        id: NOTIFICATION_ID,
        category: "needs-input",
        timestamp: Date.now() - 30_000,
        messageId: CONTEXT_MESSAGE_ID,
        contextMessageId: CONTEXT_MESSAGE_ID,
        questionOnly: true,
        summary: "Approve the restart-wait instruction fix?",
        questions: [
          {
            prompt: "File and dispatch this instruction fix?",
            suggestedAnswers: ["Yes, file and dispatch", "Change something"],
          },
        ],
        threadKey: "main",
        done: false,
      },
    ]);
    useStore.setState({ sessionNotifications: next });
    return () => {
      useStore.setState({ sessionNotifications: previous });
    };
  }, []);

  const message: ChatMessage = {
    id: CONTEXT_MESSAGE_ID,
    role: "assistant",
    content:
      "Neither wait was a retry loop: each quest needed the new build running. Proposed quest: ask you right away when work waits on your action.\n\n" +
      "- **Yes, file and dispatch:** file it and start a worker now.\n- **Change something:** say what to adjust.",
    timestamp: Date.now() - 30_000,
    metadata: {
      leaderThreadRole: "answer",
      threadKey: "main",
      threadAnswer: { version: 2, answerUserMessageIds: ["u12"], observedHistoryLength: 11, authoredThreadKey: "main" },
    },
  };

  return (
    <MessageBubble
      message={message}
      sessionId={SESSION_ID}
      showTimestamp={false}
      currentThreadKey="q-42"
      onSelectThread={NOOP}
    />
  );
}
