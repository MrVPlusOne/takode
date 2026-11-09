import { Hono } from "hono";
import { parseDuration } from "../timer-parse.js";
import { ResourceLeaseError } from "../resource-lease-manager.js";
import * as sessionNames from "../session-names.js";
import { CLIENT_HOLDER_PREFIX } from "../resource-lease-types.js";
import type {
  ResourceLease,
  ResourceLeaseHoldState,
  ResourceLeaseAcquireResult,
  ResourceLeaseReleaseResult,
  ResourceLeaseStatus,
  ResourceLeaseWaiter,
} from "../resource-lease-types.js";
import type { RouteContext } from "./context.js";

/** Longest one hold request waits for a change; the server's HTTP idle timeout must stay longer. */
const MAX_HOLD_WAIT_SECONDS = 30;

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

    const resource = await ctx.resourceLeaseManager.getStatus(
      await leaseKey(ctx, auth.callerId, c.req.param("resourceKey")),
    );
    return c.json({ resource: enrichStatusForResponse(ctx, resource) });
  });

  api.post("/resource-leases/:resourceKey/configure", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);
    if (!auth.caller.isOrchestrator)
      return c.json({ error: "Only leader sessions can configure resource capacity" }, 403);
    try {
      const body = await c.req.json();
      const resource = await ctx.resourceLeaseManager.configure(
        await leaseKey(ctx, auth.callerId, c.req.param("resourceKey")),
        body.capacity,
      );
      return c.json({ resource: enrichStatusForResponse(ctx, resource) });
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  api.post("/resource-leases/:resourceKey/acquire", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);

    try {
      const body = await c.req.json().catch(() => ({}));
      const result = await ctx.resourceLeaseManager.acquire({
        resourceKey: await leaseKey(ctx, auth.callerId, c.req.param("resourceKey")),
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
        resourceKey: await leaseKey(ctx, auth.callerId, c.req.param("resourceKey")),
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

  /**
   * `takode lease run`: take a slot for one running command (a held slot), or a
   * place in line for one. The caller names the holder (`run:<id>`), so a retry
   * after a lost answer finds the same slot.
   */
  api.post("/resource-leases/:resourceKey/hold", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);
    try {
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.holderId !== "string" || !body.holderId.startsWith(CLIENT_HOLDER_PREFIX)) {
        return c.json({ error: `holderId must start with ${CLIENT_HOLDER_PREFIX}` }, 400);
      }
      const state = await ctx.resourceLeaseManager.hold({
        resourceKeys: [await leaseKey(ctx, auth.callerId, c.req.param("resourceKey"))],
        holderId: body.holderId,
        callerSessionId: auth.callerId,
        questId: normalizeQuestId(body.questId) ?? wsBridge.getSession(auth.callerId)?.state.claimedQuestId,
        purpose: normalizePurpose(body.purpose),
        metadata: normalizeMetadata(body.metadata),
        ttlMs: normalizeTtl(body),
      });
      return c.json({ state: enrichHoldStateForResponse(ctx, state, body.holderId, auth.callerId) });
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  /**
   * Renew a held slot (or its place in line), then answer once its state
   * differs from `known` or `waitSeconds` pass: the caller's heartbeat and its
   * wait for a slot in one long poll.
   */
  api.post("/resource-leases/holds/:holderId/wait", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);
    try {
      const body = await c.req.json().catch(() => ({}));
      const holderId = c.req.param("holderId");
      const known = ["held", "queued", "gone"].includes(body.known)
        ? (body.known as ResourceLeaseHoldState["status"])
        : "gone";
      const waitSeconds = Math.min(Math.max(Number(body.waitSeconds) || 0, 0), MAX_HOLD_WAIT_SECONDS);
      await ctx.resourceLeaseManager.renewHold(holderId, auth.callerId);
      const state = await ctx.resourceLeaseManager.waitHold(holderId, known, waitSeconds * 1000);
      return c.json({ state: enrichHoldStateForResponse(ctx, state, holderId, auth.callerId) });
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  api.post("/resource-leases/holds/:holderId/release", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    if (!ctx.resourceLeaseManager) return c.json({ error: "Resource lease manager not available" }, 503);
    try {
      const released = await ctx.resourceLeaseManager.releaseHold(c.req.param("holderId"), auth.callerId);
      return c.json({ released: released ? enrichLeaseForResponse(ctx, released) : null });
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
        resourceKey: await leaseKey(ctx, auth.callerId, c.req.param("resourceKey")),
        callerSessionId: auth.callerId,
        ttlMs: normalizeTtl(body),
        slot: body.slot,
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
        resourceKey: await leaseKey(ctx, auth.callerId, c.req.param("resourceKey")),
        callerSessionId: auth.callerId,
        ttlMs: normalizeTtl(body),
        slot: body.slot,
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
      const body = await c.req.json().catch(() => ({}));
      const force = body.force === true;
      if (force && !auth.caller.isOrchestrator) {
        return c.json({ error: "Only leader sessions can force-release a resource lease" }, 403);
      }
      const result = await ctx.resourceLeaseManager.release(
        await leaseKey(ctx, auth.callerId, c.req.param("resourceKey")),
        auth.callerId,
        force,
        body.slot,
      );
      return c.json({ result: enrichReleaseResultForResponse(ctx, result) });
    } catch (err) {
      return resourceLeaseErrorResponse(c, err);
    }
  });

  return api;
}

/**
 * Lease keys name machine-local resources such as a dev server or a browser. A
 * key without `@<host>` means the caller's own machine: for a session on a
 * remote host it is qualified with that host's name, and otherwise it means
 * the coordinator's machine. A key that names a host is used as given.
 *
 * Port leases (`port:<repo>:<branch>`) are the exception: they guard a remote
 * branch, which every machine pushes to, so all machines share one pool.
 */
async function leaseKey(ctx: RouteContext, callerId: string, key: string): Promise<string> {
  if (key.includes("@") || key.trim().toLowerCase().startsWith("port:")) return key;
  const hostId = ctx.launcher?.getSession?.(callerId)?.hostId;
  if (!hostId) return key;
  const host = await ctx.launcher.remoteHosts?.registry.get(hostId);
  return `${key}@${host?.name ?? hostId}`;
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
    leases: status.leases.map((lease) => enrichLeaseForResponse(ctx, lease)),
    waiters: status.waiters.map((waiter) => enrichWaiterForResponse(ctx, waiter)),
  };
}

function enrichAcquireResultForResponse(ctx: RouteContext, result: ResourceLeaseAcquireResult) {
  return {
    ...result,
    ...("lease" in result
      ? { lease: enrichLeaseForResponse(ctx, result.lease) }
      : { leases: result.leases.map((lease) => enrichLeaseForResponse(ctx, lease)) }),
    ...(result.status === "queued" ? { waiter: enrichWaiterForResponse(ctx, result.waiter) } : {}),
    waiters: result.waiters.map((waiter) => enrichWaiterForResponse(ctx, waiter)),
  };
}

/** A held slot's state; one in line also carries `note`, where it stands, for its caller's periodic wait notes. */
function enrichHoldStateForResponse(
  ctx: RouteContext,
  state: ResourceLeaseHoldState,
  holderId: string,
  callerId: string,
) {
  if (state.status === "held") return { ...state, lease: enrichLeaseForResponse(ctx, state.lease) };
  if (state.status !== "queued") return state;
  const note = ctx.resourceLeaseManager?.describeHoldWait(holderId, Date.now(), sessionRefLabel(ctx, callerId));
  return note ? { ...state, note } : state;
}

/** Names a session as `#N`, marking the caller's own (`#N (yours)`), for slot-wait notes. */
export function sessionRefLabel(ctx: RouteContext, callerId: string): (sessionId: string) => string {
  return (sessionId) => {
    const { sessionNum } = resolveSessionLabel(ctx, sessionId);
    const ref = sessionNum !== undefined ? `#${sessionNum}` : sessionId.slice(0, 8);
    return sessionId === callerId ? `${ref} (yours)` : ref;
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
    const status =
      err.code === "forbidden" ? 403 : err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 400;
    return c.json({ error: err.message }, status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
}
