import type {
  QuestTopicsResponse,
  ThreadSummary,
  TopicDetail,
  TopicListResponse,
  TopicSummary,
} from "../../shared/library-topics.js";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: object },
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: options?.method ?? "GET",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(typeof body.error === "string" && body.error ? body.error : response.statusText);
  }
  return response.json() as Promise<T>;
}

const topicPath = (id: string) => `/topics/${encodeURIComponent(id)}`;

/** The Library's topics and Scribe API (see `server/routes/topics.ts`). */
export const topicApi = {
  /** A space's topics, or with `leader` the topics holding that leader's quests. */
  list: (space: string, leader?: string | null) =>
    request<TopicListResponse>(
      `/topics?space=${encodeURIComponent(space || "all")}${leader ? `&leader=${encodeURIComponent(leader)}` : ""}`,
    ),
  get: (id: string) => request<TopicDetail>(topicPath(id)),
  /** Starts a new thread in a leader, named `name` until the leader names it. */
  startThread: (leader: string, name: string, startedFrom?: string, firstMessage?: string) =>
    request<{ thread: ThreadSummary }>("/topics/threads", {
      method: "POST",
      body: { leader, name, ...(startedFrom ? { startedFrom } : {}), ...(firstMessage ? { firstMessage } : {}) },
    }),
  /** A line of news per thread for a leader's Home: its quests' (`quests`) and its own threads'. */
  homeLines: (leader: string, quests: readonly string[]) =>
    request<{ lines: Record<string, { text: string; at: number; source: string }> }>(
      `/topics/home-lines?leader=${encodeURIComponent(leader)}&quests=${encodeURIComponent(quests.join(","))}`,
    ),
  /** A leader's threads, newest activity first. */
  threads: (leader: string) =>
    request<{ threads: ThreadSummary[] }>(`/topics/threads?leader=${encodeURIComponent(leader)}`),
  /** Undoes the Scribe's join of a thread onto an earlier conversation: it is its own thread again. */
  unjoinThread: (leader: string, thread: string) =>
    request<{ thread: ThreadSummary }>("/topics/threads/unjoin", { method: "POST", body: { leader, thread } }),
  /** Removes a thread whose first message never arrived. */
  removeThread: (id: string) =>
    request<{ ok: true }>(`/topics/threads/${encodeURIComponent(id)}`, { method: "DELETE" }),
  rename: (id: string, name: string) => request<TopicSummary>(topicPath(id), { method: "PATCH", body: { name } }),
  merge: (id: string, into: string) =>
    request<TopicSummary>(`${topicPath(id)}/merge`, { method: "POST", body: { into } }),
  move: (questId: string, topic: string) =>
    request<TopicSummary>("/topics/move", { method: "POST", body: { questId, topic } }),
  dismissChanges: (changeIds: string[]) =>
    request<unknown>("/topics/changes/dismiss", { method: "POST", body: { ids: changeIds } }),
  undo: (changeId: string) =>
    request<unknown>(`/topics/changes/${encodeURIComponent(changeId)}/undo`, { method: "POST", body: {} }),
  /** Asks the Scribe of the leader whose panel this is to update the page now. */
  updateNow: (id: string, leader?: string | null) =>
    request<{ result: string }>(`${topicPath(id)}/update`, { method: "POST", body: leader ? { leader } : {} }),
  /** The user's lasting requests for a topic's page; the panel's leader's Scribe hears about them. */
  setPageRequests: (id: string, text: string, leader: string) =>
    request<{ instructions: string }>(`${topicPath(id)}/instructions`, { method: "POST", body: { text, leader } }),
  answerSuggestion: (suggestionId: string, accept: boolean) =>
    request<unknown>(`/topics/suggestions/${encodeURIComponent(suggestionId)}`, { method: "POST", body: { accept } }),
  /** The user's instructions for all of a leader's topics. */
  setScribeInstructions: (leaderSessionId: string, text: string) =>
    request<{ instructions: string }>(`/scribe/${encodeURIComponent(leaderSessionId)}/instructions`, {
      method: "POST",
      body: { text },
    }),
  /** Pauses or resumes a leader's Scribe. */
  setScribePaused: (leaderSessionId: string, paused: boolean) =>
    request<{ paused: boolean }>(`/scribe/${encodeURIComponent(leaderSessionId)}/pause`, {
      method: "POST",
      body: { paused },
    }),
  questMap: (leaderSessionId: string, questIds: readonly string[]) =>
    request<QuestTopicsResponse>(
      `/topics/quest-map?leader=${encodeURIComponent(leaderSessionId)}&quests=${encodeURIComponent(questIds.join(","))}`,
    ),
};
