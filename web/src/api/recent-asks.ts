const BASE = "/api";

export type RecentAskBundleStatus =
  | "awaiting_response"
  | "queued"
  | "working"
  | "needs_input"
  | "thread_needs_input"
  | "response_unread"
  | "responded"
  | "caught_up"
  | "retrying"
  | "failed"
  | "interrupted"
  | "completed";

export type RecentAskFilter = "all" | "needs_me" | "new_response" | "active";

export interface RecentAskMember {
  messageId: string;
  historyIndex: number;
  timestamp: number;
  preview: string;
  truncated: boolean;
  imageCount: number;
}

export interface RecentAskResponsePreview {
  messageId: string;
  historyIndex: number;
  timestamp: number;
  preview: string;
  truncated: boolean;
}

export interface RecentAskBundle {
  id: string;
  sessionId: string;
  sessionNum: number | null;
  sessionName: string;
  sessionState?: "starting" | "connected" | "running" | "exited";
  archived: boolean;
  archivedAt?: number;
  sessionSpaceId: string;
  sessionSpaceName: string;
  ownerThreadKey: string;
  questId?: string;
  questTitle?: string;
  questStatus?: string;
  firstAskedAt: number;
  lastAskedAt: number;
  members: RecentAskMember[];
  response?: RecentAskResponsePreview;
  status: RecentAskBundleStatus;
  statusDetail?: string;
}

export interface RecentAskBundlesResponse {
  groups: RecentAskBundle[];
  totalMatches: number;
  totalRecentGroups: number;
  limit: number;
  query: string;
  filter: RecentAskFilter;
  sessionSpaceId: string | null;
  attentionCount: number;
  sessionSpaces: Array<{ id: string; name: string; count: number }>;
  coverageNotice?: string;
  tookMs: number;
}

export interface FetchRecentAskBundlesOptions {
  filter?: RecentAskFilter;
  sessionSpaceId?: string | null;
  signal?: AbortSignal;
}

export async function fetchRecentAskBundles(
  options: FetchRecentAskBundlesOptions = {},
): Promise<RecentAskBundlesResponse> {
  const params = new URLSearchParams();
  if (options.filter && options.filter !== "all") params.set("filter", options.filter);
  if (options.sessionSpaceId) params.set("sessionSpaceId", options.sessionSpaceId);
  params.set("limit", "50");
  const query = params.toString();
  const response = await fetch(`${BASE}/sessions/recent-asks${query ? `?${query}` : ""}`, {
    signal: options.signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }
  return response.json() as Promise<RecentAskBundlesResponse>;
}
