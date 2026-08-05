import type { SessionState } from "../types.js";

const BASE = "/api";

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  return parseResponse<T>(await fetch(`${BASE}${path}`));
}

async function post<T>(path: string, body: object = {}): Promise<T> {
  return parseResponse<T>(
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export type CodexGoalResponse = {
  ok: boolean;
  goal: SessionState["codex_goal"] | null;
  capability?: SessionState["codex_goal_capability"];
  error?: string;
};

export const codexGoalApi = {
  get: (sessionId: string) => get<CodexGoalResponse>(`/sessions/${encodeURIComponent(sessionId)}/codex-goal`),
  refresh: (sessionId: string) =>
    post<CodexGoalResponse>(`/sessions/${encodeURIComponent(sessionId)}/codex-goal/refresh`),
  set: (
    sessionId: string,
    body: { objective?: string; status?: string; tokenBudget?: number | null; mode?: "edit" | "replace" },
  ) => post<CodexGoalResponse>(`/sessions/${encodeURIComponent(sessionId)}/codex-goal/set`, body),
  pause: (sessionId: string) => post<CodexGoalResponse>(`/sessions/${encodeURIComponent(sessionId)}/codex-goal/pause`),
  resume: (sessionId: string) =>
    post<CodexGoalResponse>(`/sessions/${encodeURIComponent(sessionId)}/codex-goal/resume`),
  clear: (sessionId: string) => post<CodexGoalResponse>(`/sessions/${encodeURIComponent(sessionId)}/codex-goal/clear`),
};
