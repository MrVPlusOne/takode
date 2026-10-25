import type { QuestTopicMap, TopicDetail, TopicListResponse, TopicSummary } from "../../shared/library-topics.js";

const BASE = "/api";

async function request<T>(path: string, options?: { method?: "GET" | "POST" | "PATCH"; body?: object }): Promise<T> {
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
  rename: (id: string, name: string) => request<TopicSummary>(topicPath(id), { method: "PATCH", body: { name } }),
  merge: (id: string, into: string) =>
    request<TopicSummary>(`${topicPath(id)}/merge`, { method: "POST", body: { into } }),
  move: (questId: string, topic: string) =>
    request<TopicSummary>("/topics/move", { method: "POST", body: { questId, topic } }),
  undo: (changeId: string) =>
    request<unknown>(`/topics/changes/${encodeURIComponent(changeId)}/undo`, { method: "POST", body: {} }),
  /** Asks the Scribe of the leader whose panel this is to update the page now. */
  updateNow: (id: string, leader?: string | null) =>
    request<{ result: string }>(`${topicPath(id)}/update`, { method: "POST", body: leader ? { leader } : {} }),
  /** Marks a Now item of the page done (or takes it back); the panel's leader's Scribe hears it. */
  nowDone: (id: string, key: string, leader: string, done = true) =>
    request<{ ok: boolean }>(`${topicPath(id)}/now-done`, { method: "POST", body: { key, leader, done } }),
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
  setLeaderEnabled: (sessionId: string, enabled: boolean) =>
    request<{ enabled: boolean }>(`/topics/leaders/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: { enabled },
    }),
  dismissHint: (sessionId: string) =>
    request<{ ok: true }>(`/topics/leaders/${encodeURIComponent(sessionId)}/dismiss-hint`, {
      method: "POST",
      body: {},
    }),
  /** Pauses or resumes a leader's Scribe. */
  setScribePaused: (leaderSessionId: string, paused: boolean) =>
    request<{ paused: boolean }>(`/scribe/${encodeURIComponent(leaderSessionId)}/pause`, {
      method: "POST",
      body: { paused },
    }),
  questMap: (leaderSessionId: string, questIds: readonly string[]) =>
    request<{ enabled: boolean; map: QuestTopicMap }>(
      `/topics/quest-map?leader=${encodeURIComponent(leaderSessionId)}&quests=${encodeURIComponent(questIds.join(","))}`,
    ),
};
