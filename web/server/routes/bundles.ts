import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RouteContext } from "./context.js";

/** What `takode bundle send` uploads and `takode bundle fetch` receives. */
export interface CommitBundle {
  id: string;
  createdAt: number;
  /** Session that sent the bundle. */
  sessionId: string;
  sessionNum?: number;
  /** Branch the commits were made on. */
  branch: string;
  /** Commit the bundle starts after; the receiving repo must already have it. */
  base: string;
  /** Last commit in the bundle. */
  tip: string;
  /** Commits from oldest to newest. */
  commits: { sha: string; subject: string }[];
  size: number;
}

/** Bundles older than this are deleted when a new one arrives. */
const BUNDLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Keeps the base64 request well under the server's default request body limit. */
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const BUNDLE_ID = /^b-[0-9a-f]{8}$/;

/**
 * Git bundles that carry a worker's commits from the machine it ran on to the
 * machine of its port target, through this server. The worker uploads with
 * `takode bundle send`; a session on the target machine downloads the bundle
 * with `takode bundle fetch` and lands the commits under the usual port rules.
 */
export function createBundleRoutes(ctx: RouteContext, dir = join(homedir(), ".companion", "bundles")) {
  const api = new Hono();

  api.post("/bundles", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const body = (await c.req.json().catch(() => null)) as {
      branch?: unknown;
      base?: unknown;
      tip?: unknown;
      commits?: unknown;
      data?: unknown;
    } | null;
    if (
      !body ||
      typeof body.branch !== "string" ||
      typeof body.base !== "string" ||
      typeof body.tip !== "string" ||
      typeof body.data !== "string" ||
      !Array.isArray(body.commits)
    ) {
      return c.json({ error: "Expected { branch, base, tip, commits, data }" }, 400);
    }
    const data = Buffer.from(body.data, "base64");
    if (data.length > MAX_BUNDLE_BYTES) return c.json({ error: "Bundle is larger than 64 MB" }, 413);
    const bundle: CommitBundle = {
      id: `b-${randomBytes(4).toString("hex")}`,
      createdAt: Date.now(),
      sessionId: auth.callerId,
      ...(ctx.launcher.getSessionNum(auth.callerId) !== undefined
        ? { sessionNum: ctx.launcher.getSessionNum(auth.callerId) }
        : {}),
      branch: body.branch,
      base: body.base,
      tip: body.tip,
      commits: (body.commits as { sha?: unknown; subject?: unknown }[]).map((commit) => ({
        sha: String(commit.sha ?? ""),
        subject: String(commit.subject ?? ""),
      })),
      size: data.length,
    };
    await mkdir(dir, { recursive: true });
    await removeExpiredBundles(dir);
    await writeFile(join(dir, `${bundle.id}.bundle`), data);
    await writeFile(join(dir, `${bundle.id}.json`), JSON.stringify(bundle, null, 2));
    return c.json({ bundle }, 201);
  });

  api.get("/bundles", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const names = await readdir(dir).catch(() => [] as string[]);
    const bundles = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => JSON.parse(await readFile(join(dir, name), "utf-8")) as CommitBundle),
    );
    return c.json({ bundles: bundles.sort((a, b) => b.createdAt - a.createdAt) });
  });

  api.get("/bundles/:id", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const id = c.req.param("id");
    if (!BUNDLE_ID.test(id)) return c.json({ error: "Bundle not found" }, 404);
    try {
      const bundle = JSON.parse(await readFile(join(dir, `${id}.json`), "utf-8")) as CommitBundle;
      const data = await readFile(join(dir, `${id}.bundle`));
      return c.json({ bundle, data: data.toString("base64") });
    } catch {
      return c.json({ error: "Bundle not found" }, 404);
    }
  });

  return api;
}

async function removeExpiredBundles(dir: string): Promise<void> {
  const cutoff = Date.now() - BUNDLE_RETENTION_MS;
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const bundle = JSON.parse(await readFile(join(dir, name), "utf-8")) as CommitBundle;
    if (bundle.createdAt >= cutoff) continue;
    await rm(join(dir, `${bundle.id}.bundle`), { force: true });
    await rm(join(dir, name), { force: true });
  }
}
