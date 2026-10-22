/** The one-time offer to switch leader portraits to the Animals set; the server decides and records it. */

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/leader-profile/animals-offer${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || response.statusText);
  }
  return response.json() as Promise<T>;
}

export function getAnimalPortraitsOffer(): Promise<{ show: boolean }> {
  return request("");
}

/** `currentLeaders` also gives every active leader a new animal portrait, replacing its current one. */
export function acceptAnimalPortraitsOffer(currentLeaders: boolean): Promise<{ reassignedLeaders: number }> {
  return request("/accept", { currentLeaders });
}

export function dismissAnimalPortraitsOffer(): Promise<{ ok: boolean }> {
  return request("/dismiss", {});
}
