import type { Hono } from "hono";
import * as sessionNames from "../session-names.js";
import { isSessionPaused } from "../session-pause.js";
import type { RouteContext } from "./context.js";
import { relaunchSessionProcess } from "./session-process-relaunch.js";

export type LeaderReconnectResultReason =
  | "reconnect_started"
  | "not_found"
  | "not_owned"
  | "not_worker"
  | "archived"
  | "paused"
  | "already_connected"
  | "already_reconnecting"
  | "generating"
  | "relaunch_failed";

export interface LeaderReconnectResult {
  ref: string;
  sessionId?: string;
  sessionNum?: number;
  name?: string;
  status: "started" | "skipped" | "failed";
  reason: LeaderReconnectResultReason;
  detail?: string;
}

export function registerTakodeReconnectRoute(api: Hono, ctx: RouteContext): void {
  const { authenticateTakodeCaller, launcher, resolveId, wsBridge } = ctx;
  api.post("/takode/reconnect", async (c) => {
    const auth = authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;

    const body = await c.req.json().catch(() => ({}));
    const reconnectAll = body.all === true;
    const requestedRefs: string[] = Array.isArray(body.workerIds)
      ? body.workerIds.map((value: unknown) => String(value).trim()).filter((value: string) => value.length > 0)
      : [];
    if (reconnectAll === requestedRefs.length > 0) {
      return c.json({ error: "Provide either all=true or a non-empty workerIds array" }, 400);
    }

    const refs = reconnectAll
      ? launcher.getHerdedSessions(auth.callerId).map((session) => session.sessionId)
      : requestedRefs;
    const uniqueRefs = [...new Set(refs)];
    const results: LeaderReconnectResult[] = [];

    for (const ref of uniqueRefs) {
      const sessionId = resolveId(ref);
      const info = sessionId ? launcher.getSession(sessionId) : null;
      const base = { ref, ...(sessionId ? { sessionId } : {}) };
      if (!sessionId || !info) {
        results.push({ ...base, status: "skipped", reason: "not_found" });
        continue;
      }
      const name = sessionNames.getName(sessionId);
      const identified = {
        ...base,
        ...(typeof info.sessionNum === "number" ? { sessionNum: info.sessionNum } : {}),
        ...(name ? { name } : {}),
      };
      if (info.herdedBy !== auth.callerId) {
        results.push({ ...identified, status: "skipped", reason: "not_owned" });
        continue;
      }
      if (info.isOrchestrator) {
        results.push({ ...identified, status: "skipped", reason: "not_worker" });
        continue;
      }
      if (info.archived) {
        results.push({ ...identified, status: "skipped", reason: "archived" });
        continue;
      }
      const bridgeSession = wsBridge.getSession(sessionId);
      if (isSessionPaused(bridgeSession)) {
        results.push({ ...identified, status: "skipped", reason: "paused" });
        continue;
      }
      if (bridgeSession?.isGenerating) {
        results.push({ ...identified, status: "skipped", reason: "generating" });
        continue;
      }
      if (wsBridge.isBackendConnected(sessionId)) {
        results.push({ ...identified, status: "skipped", reason: "already_connected" });
        continue;
      }
      if (
        bridgeSession?.state.backend_state === "initializing" ||
        bridgeSession?.state.backend_state === "resuming" ||
        bridgeSession?.state.backend_state === "recovering"
      ) {
        results.push({ ...identified, status: "skipped", reason: "already_reconnecting" });
        continue;
      }

      const relaunched = await relaunchSessionProcess(launcher, wsBridge, sessionId);
      if (!relaunched.ok) {
        results.push({
          ...identified,
          status: "failed",
          reason: "relaunch_failed",
          detail: relaunched.error || "Relaunch failed",
        });
        continue;
      }
      results.push({ ...identified, status: "started", reason: "reconnect_started" });
    }

    return c.json({
      ok: true,
      all: reconnectAll,
      requested: uniqueRefs.length,
      started: results.filter((result) => result.status === "started").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    });
  });
}
