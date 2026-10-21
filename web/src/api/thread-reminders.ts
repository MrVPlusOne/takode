/** "Remind me later" for a leader thread: the server keeps the wake time and brings the thread back. */
export async function setThreadReminder(
  sessionId: string,
  threadKey: string,
  durationMs: number,
  messageId?: string,
): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/thread-reminders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadKey, durationMs, ...(messageId ? { messageId } : {}) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Could not set the reminder");
  }
}

export async function cancelThreadReminder(sessionId: string, threadKey: string): Promise<void> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/thread-reminders/${encodeURIComponent(threadKey)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Could not cancel the reminder");
  }
}
