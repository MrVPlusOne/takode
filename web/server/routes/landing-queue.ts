import { Hono, type Context } from "hono";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as questStore from "../quest-store.js";
import { getTakodeQuestOwnerSessionId } from "../../shared/quest-owner.js";
import { LandingQueueError } from "../landing-queue-manager.js";
import type {
  LandingEntryOutcome,
  LandingPreSubmitTest,
  LandingPushPlan,
  LandingRunReport,
  LandingTarget,
} from "../../shared/landing-queue.js";
import type { RouteContext } from "./context.js";

const SHA = /^[0-9a-f]{40}$/;
const BUNDLE_ID = /^b-[0-9a-f]{8}$/;

/**
 * Landing queue routes for `takode land`. Workers submit entries; the session
 * holding the target's port lease claims them as one landing run and reports
 * its plan and outcome. The queue logic lives in LandingQueueManager.
 */
export function createLandingQueueRoutes(ctx: RouteContext, bundleDir = join(homedir(), ".companion", "bundles")) {
  const api = new Hono();

  const guard = (c: Context) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return { response: auth.response };
    const queue = ctx.wsBridge.landingQueue;
    if (!queue) return { response: c.json({ error: "Landing queue not available" }, 503) };
    return { auth, queue };
  };

  api.post("/takode/land/submit", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const target = parseTarget(body.target);
      if (typeof body.bundleId !== "string" || !BUNDLE_ID.test(body.bundleId))
        throw new LandingQueueError(400, "bundleId must name an uploaded bundle.");
      await access(join(bundleDir, `${body.bundleId}.bundle`)).catch(() => {
        throw new LandingQueueError(400, `Bundle ${body.bundleId} was not found on this server.`);
      });
      const base = sha(body.base, "base");
      const tip = sha(body.tip, "tip");
      const commits = Array.isArray(body.commits)
        ? body.commits.map((commit: { sha?: unknown; subject?: unknown }) => ({
            sha: sha(commit?.sha, "commit"),
            subject: String(commit?.subject ?? "").slice(0, 300),
          }))
        : [];
      if (commits.length === 0 || commits.at(-1)!.sha !== tip)
        throw new LandingQueueError(400, "commits must list the entry's commits, oldest first, ending at tip.");
      const questId = typeof body.questId === "string" && body.questId ? body.questId.toLowerCase() : undefined;
      if (questId) {
        if (!/^q-\d+$/.test(questId)) throw new LandingQueueError(400, "questId must match q-N.");
        const quest = await questStore.getQuest(questId);
        if (!quest || getTakodeQuestOwnerSessionId(quest) !== g.auth.callerId)
          throw new LandingQueueError(403, `${questId} is not claimed by this session.`);
      }
      const preparationId = typeof body.preparationId === "string" ? body.preparationId : undefined;
      if (preparationId !== undefined && !/^[a-f0-9]{32}$/.test(preparationId))
        throw new LandingQueueError(400, "preparationId must be an exact preparation ID.");
      const result = await g.queue.submit({
        callerSessionId: g.auth.callerId,
        hostId: g.auth.caller.hostId,
        target,
        questId,
        preparationId,
        bundleId: body.bundleId,
        base,
        tip,
        commits,
        preSubmitTest: parsePreSubmitTest(body.preSubmitTest),
      });
      return c.json(result, 201);
    } catch (error) {
      return landingError(c, error);
    }
  });

  api.get("/takode/land/queue", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    try {
      const target = parseTarget({ repo: c.req.query("repo"), branch: c.req.query("branch") });
      return c.json(await g.queue.snapshot(target));
    } catch (error) {
      return landingError(c, error);
    }
  });

  api.get("/takode/land/entries/latest", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    const entry = await g.queue.latestEntryFor(g.auth.callerId, c.req.query("questId")?.toLowerCase() || undefined);
    if (!entry) return c.json({ error: "This session has no landing entry." }, 404);
    return c.json({ entry });
  });

  api.post("/takode/land/entries/:id/withdraw", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    try {
      const caller = g.auth.callerId;
      const entry = await g.queue.withdraw(
        c.req.param("id"),
        caller,
        (owner) => g.auth.caller.isOrchestrator === true && ctx.launcher.getSession(owner)?.herdedBy === caller,
      );
      return c.json({ entry });
    } catch (error) {
      return landingError(c, error);
    }
  });

  api.post("/takode/land/runs", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      return c.json(await g.queue.claim(g.auth.callerId, parseTarget(body.target), g.auth.caller.hostId));
    } catch (error) {
      return landingError(c, error);
    }
  });

  api.post("/takode/land/runs/:id/:action", async (c) => {
    const g = guard(c);
    if ("response" in g) return g.response;
    try {
      const runId = c.req.param("id");
      const caller = g.auth.callerId;
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      switch (c.req.param("action")) {
        case "heartbeat":
          return c.json({
            run: await g.queue.heartbeat(runId, caller, optionalString(body.phase), optionalString(body.logPath)),
          });
        case "plan":
          return c.json({ run: await g.queue.recordPlan(runId, caller, parsePlan(body.plan)) });
        case "finish":
          return c.json({ run: await g.queue.finish(runId, caller, parseReport(body.report)) });
        case "reconcile":
          if (typeof body.pushed !== "boolean") throw new LandingQueueError(400, "pushed must be true or false.");
          return c.json({ run: await g.queue.reconcile(runId, caller, body.pushed) });
        default:
          throw new LandingQueueError(404, "Unknown landing run action.");
      }
    } catch (error) {
      return landingError(c, error);
    }
  });

  return api;
}

function landingError(c: Context, error: unknown): Response {
  if (error instanceof LandingQueueError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "Landing queue operation failed.";
  console.warn("[landing-queue] Request failed:", message);
  return c.json({ error: message }, 409);
}

function parseTarget(raw: unknown): LandingTarget {
  const target = raw as Partial<LandingTarget> | null;
  const repo = typeof target?.repo === "string" ? target.repo.trim().toLowerCase() : "";
  const branch = typeof target?.branch === "string" ? target.branch.trim() : "";
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(repo)) throw new LandingQueueError(400, "target.repo must be a repository name.");
  if (!branch || branch === "HEAD" || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch))
    throw new LandingQueueError(400, "target.branch must be a branch name.");
  return { repo, branch };
}

function sha(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA.test(value))
    throw new LandingQueueError(400, `${name} must be a full lowercase SHA.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function parsePreSubmitTest(raw: unknown): LandingPreSubmitTest {
  const test = raw as Record<string, unknown> | null;
  if (test?.kind === "passed" && typeof test.patchId === "string" && typeof test.tree === "string") {
    return {
      kind: "passed",
      patchId: test.patchId,
      tree: sha(test.tree, "preSubmitTest.tree"),
      summary: String(test.summary ?? "").slice(0, 500),
      at: typeof test.at === "number" ? test.at : Date.now(),
    };
  }
  if (test?.kind === "skipped" && typeof test.reason === "string" && test.reason.trim())
    return { kind: "skipped", reason: test.reason.trim().slice(0, 500) };
  throw new LandingQueueError(400, "preSubmitTest must record a passing `takode land test` or a skip reason.");
}

function parseMapping(raw: unknown): LandingPushPlan["mapping"][string] {
  if (!Array.isArray(raw) || raw.length === 0) throw new LandingQueueError(400, "Each mapping needs commits.");
  return raw.map((commit: Record<string, unknown>) => ({
    source: sha(commit?.source, "mapping source"),
    target: sha(commit?.target, "mapping target"),
    subject: String(commit?.subject ?? "").slice(0, 300),
    ...(commit?.integrated === true ? { integrated: true } : {}),
  }));
}

function parsePlan(raw: unknown): LandingPushPlan {
  const plan = raw as Record<string, unknown> | null;
  const mapping = plan?.mapping as Record<string, unknown> | undefined;
  if (!mapping || typeof mapping !== "object") throw new LandingQueueError(400, "plan.mapping is required.");
  return {
    base: sha(plan?.base, "plan.base"),
    tip: sha(plan?.tip, "plan.tip"),
    mapping: Object.fromEntries(Object.entries(mapping).map(([id, commits]) => [id, parseMapping(commits)])),
  };
}

function parseReport(raw: unknown): LandingRunReport {
  const report = raw as Record<string, unknown> | null;
  if (!report || !Array.isArray(report.outcomes)) throw new LandingQueueError(400, "report.outcomes is required.");
  const outcomes: LandingEntryOutcome[] = report.outcomes.map((item: Record<string, unknown>) => {
    const entryId = String(item?.entryId ?? "");
    if (item?.outcome === "landed") return { entryId, outcome: "landed", mapping: parseMapping(item.mapping) };
    const reason = String(item?.reason ?? "").slice(0, 1000) || "No reason given.";
    if (item?.outcome === "bounced")
      return { entryId, outcome: "bounced", reason, ...(item.details ? { details: String(item.details) } : {}) };
    if (item?.outcome === "requeue") return { entryId, outcome: "requeue", reason };
    throw new LandingQueueError(400, `Unknown outcome for entry ${entryId}.`);
  });
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item).slice(0, 300)).slice(0, 50) : undefined;
  return {
    outcomes,
    ...(report.pushedTip ? { pushedTip: sha(report.pushedTip, "pushedTip") } : {}),
    summary: String(report.summary ?? "").slice(0, 2000),
    ...(strings(report.flaky) ? { flaky: strings(report.flaky) } : {}),
    ...(strings(report.preexisting) ? { preexisting: strings(report.preexisting) } : {}),
    ...(typeof report.logPath === "string" ? { logPath: report.logPath } : {}),
  };
}
