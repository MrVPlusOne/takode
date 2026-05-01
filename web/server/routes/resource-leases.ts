import { Hono } from "hono";
import { parseDuration } from "../timer-parse.js";
import { ResourceLeaseError } from "../resource-lease-manager.js";
import * as sessionNames from "../session-names.js";
import type {
  ResourceLease,
  ResourceLeaseAcquireResult,
  ResourceLeaseReleaseResult,
  ResourceLeaseStatus,
  ResourceLeaseWaiter,
} from "../resource-lease-types.js";
import type { RouteContext } from "./context.js";

export function createResourceLeaseRoutes(ctx: RouteContext) {
  const api = new Hono();
  const { authenticateTakodeCaller, wsBridge } = ctx;

  api.get("/resource-leases", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);

    const resources = (await ctx.resourceLeaseManager.listStatuses()).map((status) =>
      enrichStatusForResponse(ctx, status),
    );
    return c.json({ resources });
  });

  api.get("/resource-leases/:resourceKey", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);

    const resource = await ctx.resourceLeaseManager.getStatus(c.req.param("resourceKey"));
    return c.json({ resource: enrichStatusForResponse(ctx, resource) });
  });

  api.post("/resource-leases/:resourceKey/acquire", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);

    try {
      const body = await c.req.json().catch(() => ({}));
      const result = await ctx.resourceLeaseManager.acquire({
        resourceKey: c.req.param("resourceKey"),
        callerSessionId: auth.callerId,
        questId: normalizeQuestId(body.questId) ?? wsBridge.getSession(auth.callerId)?.state.claimedQuestId,
        purpose: normalizePurpose(body.purpose),
        metadata: normalizeMetadata(body.metadata),
        ttlMs: normalizeTtl(body),
        waitIfUnavailable: body.wait === true || body.waitIfUnavailable === true,
      });
      return c.json({ result: enrichAcquireResultForResponse(ctx, result) }, statusCodeForAcquireResult(result.status));
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  api.post("/resource-leases/:resourceKey/wait", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);

    try {
      const body = await c.req.json().catch(() => ({}));
      const result = await ctx.resourceLeaseManager.wait({
        resourceKey: c.req.param("resourceKey"),
        callerSessionId: auth.callerId,
        questId: normalizeQuestId(body.questId) ?? wsBridge.getSession(auth.callerId)?.state.claimedQuestId,
        purpose: normalizePurpose(body.purpose),
        metadata: normalizeMetadata(body.metadata),
        ttlMs: normalizeTtl(body),
        waitIfUnavailable: true,
      });
      return c.json({ result: enrichAcquireResultForResponse(ctx, result) }, statusCodeForAcquireResult(result.status));
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  api.post("/resource-leases/:resourceKey/renew", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);

    try {
      const body = await c.req.json().catch(() => ({}));
      const lease = await ctx.resourceLeaseManager.renew({
        resourceKey: c.req.param("resourceKey"),
        callerSessionId: auth.callerId,
        ttlMs: normalizeTtl(body),
      });
      return c.json({ lease: enrichLeaseForResponse(ctx, lease) });
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  api.post("/resource-leases/:resourceKey/heartbeat", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);

    try {
      const body = await c.req.json().catch(() => ({}));
      const lease = await ctx.resourceLeaseManager.renew({
        resourceKey: c.req.param("resourceKey"),
        callerSessionId: auth.callerId,
        ttlMs: normalizeTtl(body),
      });
      return c.json({ lease: enrichLeaseForResponse(ctx, lease) });
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  api.post("/resource-leases/:resourceKey/release", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);

    try {
      const result = await ctx.resourceLeaseManager.release(c.req.param("resourceKey"), auth.callerId);
      return c.json({ result: enrichReleaseResultForResponse(ctx, result) });
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  return api;
}

type LeaseResponse = ResourceLease & {
  ownerSessionNum?: number;
  ownerSessionName?: string;
};

type WaiterResponse = ResourceLeaseWaiter & {
  waiterSessionNum?: number;
  waiterSessionName?: string;
};

function enrichStatusForResponse(ctx: RouteContext, status: ResourceLeaseStatus) {
  return {
    ...status,
    lease: status.lease ? enrichLeaseForResponse(ctx, status.lease) : null,
    waiters: status.waiters.map((waiter) => enrichWaiterForResponse(ctx, waiter)),
  };
}

function enrichAcquireResultForResponse(ctx: RouteContext, result: ResourceLeaseAcquireResult) {
  if (result.status === "queued") {
    return {
      ...result,
      lease: enrichLeaseForResponse(ctx, result.lease),
      waiter: enrichWaiterForResponse(ctx, result.waiter),
      waiters: result.waiters.map((waiter) => enrichWaiterForResponse(ctx, waiter)),
    };
  }
  return {
    ...result,
    lease: enrichLeaseForResponse(ctx, result.lease),
    waiters: result.waiters.map((waiter) => enrichWaiterForResponse(ctx, waiter)),
  };
}

function enrichReleaseResultForResponse(ctx: RouteContext, result: ResourceLeaseReleaseResult) {
  return {
    ...result,
    released: enrichLeaseForResponse(ctx, result.released),
    promoted: result.promoted ? enrichLeaseForResponse(ctx, result.promoted) : null,
    waiters: result.waiters.map((waiter) => enrichWaiterForResponse(ctx, waiter)),
  };
}

function enrichLeaseForResponse(ctx: RouteContext, lease: ResourceLease): LeaseResponse {
  const owner = resolveSessionLabel(ctx, lease.ownerSessionId);
  return {
    ...lease,
    ...(owner.sessionNum !== undefined ? { ownerSessionNum: owner.sessionNum } : {}),
    ...(owner.sessionName ? { ownerSessionName: owner.sessionName } : {}),
  };
}

function enrichWaiterForResponse(ctx: RouteContext, waiter: ResourceLeaseWaiter): WaiterResponse {
  const waiterSession = resolveSessionLabel(ctx, waiter.waiterSessionId);
  return {
    ...waiter,
    ...(waiterSession.sessionNum !== undefined ? { waiterSessionNum: waiterSession.sessionNum } : {}),
    ...(waiterSession.sessionName ? { waiterSessionName: waiterSession.sessionName } : {}),
  };
}

function resolveSessionLabel(ctx: RouteContext, sessionId: string): { sessionNum?: number; sessionName?: string } {
  const launcherSession = ctx.launcher?.getSession?.(sessionId);
  const sessionNum = ctx.launcher?.getSessionNum?.(sessionId) ?? launcherSession?.sessionNum;
  const sessionName = sessionNames.getName(sessionId) ?? launcherSession?.name;
  return {
    ...(typeof sessionNum === "number" ? { sessionNum } : {}),
    ...(sessionName ? { sessionName } : {}),
  };
}

function statusCodeForAcquireResult(status: string): 200 | 201 | 202 {
  if (status === "acquired") return 201;
  if (status === "queued") return 202;
  return 200;
}

function normalizePurpose(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function normalizeQuestId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : undefined;
}

function normalizeMetadata(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => [key.trim(), String(value ?? "").trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

function normalizeTtl(body: Record<string, unknown>): number | undefined {
  if (typeof body.ttlMs === "number") return body.ttlMs;
  if (typeof body.ttl === "string" && body.ttl.trim()) return parseDuration(body.ttl);
  return undefined;
}

function resourceLeaseErrorResponse(c: any, err: unknown): Response {
  if (err instanceof ResourceLeaseError) {
    const status = err.code === "forbidden" ? 403 : err.code === "not_found" ? 404 : 400;
    return c.json({ error: err.message }, status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
}
