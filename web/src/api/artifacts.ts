import type {
  ArtifactDetail,
  ArtifactKind,
  ArtifactListResponse,
  ArtifactVersionContent,
} from "../../shared/artifact-library.js";

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

export interface ArtifactListParams {
  space?: string;
  kind?: ArtifactKind;
  since?: number;
  starred?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
  /** Only artifacts made in these quest tabs, such as a topic's quests. */
  threads?: string[];
  /** A leader's Library: what it and its workers made. */
  leader?: string;
}

/** The artifact library's API (see `server/routes/artifacts.ts`). */
export const artifactApi = {
  list(params: ArtifactListParams = {}) {
    const query = new URLSearchParams();
    // The browser has no session of its own, so an absent space means all spaces.
    query.set("space", params.space || "all");
    if (params.kind) query.set("kind", params.kind);
    if (params.since) query.set("since", String(params.since));
    if (params.starred) query.set("starred", "1");
    if (params.query?.trim()) query.set("q", params.query.trim());
    if (params.threads?.length) query.set("threads", params.threads.join(","));
    if (params.leader) query.set("leader", params.leader);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    return request<ArtifactListResponse>(`/artifacts?${query}`);
  },

  get: (id: string) => request<ArtifactDetail>(`/artifacts/${encodeURIComponent(id)}`),

  versionContent: (id: string, n: number) =>
    request<ArtifactVersionContent>(`/artifacts/${encodeURIComponent(id)}/versions/${n}`),

  setStarred: (id: string, starred: boolean) =>
    request<ArtifactDetail>(`/artifacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { starred },
    }),

  rename: (id: string, title: string) =>
    request<ArtifactDetail>(`/artifacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { title },
    }),
};

/** URL of an artifact's newest saved figure file. */
export function artifactFileUrl(id: string): string {
  return `${BASE}/artifacts/${encodeURIComponent(id)}/file`;
}
