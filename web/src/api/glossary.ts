/** Whether the user has opened the glossary on this server (see `server/routes/glossary.ts`). */

async function request(method: "GET" | "POST"): Promise<{ opened: boolean }> {
  const response = await fetch("/api/glossary/opened", { method });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || response.statusText);
  }
  return response.json() as Promise<{ opened: boolean }>;
}

export function getGlossaryOpened(): Promise<{ opened: boolean }> {
  return request("GET");
}

/** Records that the user opened the glossary. */
export function markGlossaryOpened(): Promise<{ opened: boolean }> {
  return request("POST");
}
