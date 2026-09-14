import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Read exact stored replies only when the user opens a completed decision. */
export function NeedsInputResponseHistory({
  sessionId,
  notificationId,
}: {
  sessionId: string;
  notificationId: string;
}) {
  const [replies, setReplies] = useState<Array<{ content: string }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setReplies(null);
    setFailed(false);
    api.getNotificationReplies(sessionId, notificationId).then(
      (result) => {
        if (active) setReplies(result.replies);
      },
      (error) => {
        console.warn("Failed to load notification replies", error);
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId, notificationId, attempt]);

  if (failed) {
    return (
      <div role="status">
        Responses could not be loaded.{" "}
        <button type="button" className="cursor-pointer underline" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>
      </div>
    );
  }
  if (!replies) return <div role="status">Loading responses...</div>;
  if (!replies.length) return <div>No saved response is available.</div>;
  return (
    <div className="space-y-2">
      <div className="font-medium">{replies.length === 1 ? "Your response" : "Your responses"}</div>
      {replies.map((reply, index) => (
        <div key={index} className="whitespace-pre-wrap break-words text-cc-fg">
          {reply.content}
        </div>
      ))}
    </div>
  );
}
