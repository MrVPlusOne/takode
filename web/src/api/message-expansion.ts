/** Expands or collapses a message's long content for every browser of the session. */
export async function setMessageExpanded(sessionId: string, messageId: string, expanded: boolean): Promise<void> {
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/expanded-messages/${encodeURIComponent(messageId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expanded }),
    },
  );
  if (!response.ok) throw new Error(`Could not save the expansion (${response.status})`);
}
