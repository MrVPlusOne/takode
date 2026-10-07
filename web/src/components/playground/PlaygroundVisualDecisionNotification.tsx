import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { useStore } from "../../store.js";
import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";

const SESSION_ID = "playground-visual-decision-notify";
const NOTIFICATION_ID = "n-visual-decision-1";
const CONTEXT_MESSAGE_ID = `needs-input-context-${NOTIFICATION_ID}`;

/** A visual design decision whose needs-input context names screenshot paths, shown as thumbnails. */
export function PlaygroundVisualDecisionNotification() {
  // Thumbnails need real image files on the server host; the portrait assets under the server's
  // working directory stand in for screenshots. Missing files simply show no thumbnail.
  const [assetRoot, setAssetRoot] = useState("/tmp/takode-playground");
  useEffect(() => {
    let cancelled = false;
    api
      .getHome()
      .then(({ cwd }) => {
        if (!cancelled) setAssetRoot(`${cwd}/public/leader-profile-portraits/tako`);
      })
      .catch((error: unknown) => console.warn("[Playground] Could not resolve screenshot stand-ins.", error));
    return () => {
      cancelled = true;
    };
  }, []);

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
        summary: "Choose the header layout",
        questions: [{ prompt: "Which layout?", suggestedAnswers: ["A", "B"] }],
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
    content: [
      "Two header layouts are ready. Both keep the same controls; they differ only in how the title fits.",
      "",
      `- **A: one line**, truncates long titles. \`${assetRoot}/tako1-01.v2.320.webp\``,
      `- **B: wrapped**, shows the full title but is taller. \`${assetRoot}/tako1-02.v2.320.webp\``,
      "",
      "I recommend **A** because the header stays compact on phones.",
    ].join("\n"),
    timestamp: Date.now() - 30_000,
  };

  return <MessageBubble message={message} sessionId={SESSION_ID} showTimestamp={false} />;
}
