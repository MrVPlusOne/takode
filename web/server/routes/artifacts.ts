import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import {
  ARTIFACT_KINDS,
  type ArtifactGuidedReview,
  type ArtifactKind,
  type ArtifactListQuery,
} from "../../shared/artifact-library.js";
import { getArtifactLibrary, type ArtifactLibrary } from "../artifact-library.js";
import { getArtifactThumbnails, type ArtifactThumbnails } from "../artifact-thumbnails.js";
import { sharedLocalImageVariantStore } from "../local-image-variant-store.js";
import type { RouteContext } from "./context.js";

const FIGURE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * The artifact library's API, for the Library page and `takode artifact`: list and search
 * artifacts, read a version's saved content or a figure's file, and star, rename or merge.
 */
export function createArtifactRoutes(
  ctx: RouteContext,
  library: () => ArtifactLibrary | null = getArtifactLibrary,
  thumbnails: () => ArtifactThumbnails | null = getArtifactThumbnails,
) {
  const api = new Hono();

  api.get("/artifacts", (c) => {
    const lib = library();
    if (!lib) return c.json({ artifacts: [], total: 0, kinds: {}, spaces: [] });
    const query: ArtifactListQuery = {};
    // An agent sees its own session's space unless it asks for another one, or for all.
    const space = c.req.query("space") ?? callerSpace(c);
    if (space && space !== "all") query.space = space;
    const kind = c.req.query("kind");
    if (kind) {
      if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) return c.json({ error: `Unknown kind: ${kind}` }, 400);
      query.kind = kind as ArtifactKind;
    }
    const since = Number(c.req.query("since"));
    if (Number.isFinite(since) && since > 0) query.since = since;
    if (c.req.query("starred") === "1") query.starred = true;
    const text = c.req.query("q");
    if (text) query.query = text;
    const threads = c.req.query("threads");
    if (threads) query.threadKeys = threads.split(",").filter(Boolean);
    const session = c.req.query("session");
    if (session) query.sessionId = ctx.resolveId(session) ?? session;
    const leader = c.req.query("leader");
    if (leader) {
      const leaderId = ctx.resolveId(leader) ?? leader;
      query.sessionIds = leaderFamily(ctx, leaderId);
      // A leader's artifacts are what it and its workers made, wherever their spaces.
      if (!c.req.query("space")) delete query.space;
    }
    const limit = Number(c.req.query("limit"));
    if (Number.isFinite(limit) && limit > 0) query.limit = limit;
    const offset = Number(c.req.query("offset"));
    if (Number.isFinite(offset) && offset > 0) query.offset = offset;
    return c.json({ ...lib.store.list(query), space: query.space ?? null });
  });

  const callerSpace = (c: import("hono").Context): string | undefined => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    const lib = library();
    return auth && "callerId" in auth && lib ? lib.spaceFor(auth.callerId) : undefined;
  };

  /** The artifact the `:id` parameter names, by ID or unique prefix. */
  const resolve = (lib: ArtifactLibrary | null, ref: string) => (lib ? lib.store.resolveId(ref) : null);

  api.get("/artifacts/:id", (c) => {
    const lib = library();
    const id = resolve(lib, c.req.param("id"));
    const detail = id ? lib!.store.get(id) : null;
    return detail ? c.json(detail) : c.json({ error: "Artifact not found" }, 404);
  });

  api.get("/artifacts/:id/versions/:n", async (c) => {
    const lib = library();
    const n = Number(c.req.param("n"));
    if (!lib || !Number.isInteger(n)) return c.json({ error: "Version not found" }, 404);
    const id = resolve(lib, c.req.param("id"));
    const content = id ? await lib.store.versionContent(id, n) : null;
    if (!content) return c.json({ error: "This version was not kept" }, 404);
    if (content.kind === "review") {
      const source = lib.store.get(id!)?.versions.find((version) => version.n === n)?.source;
      const review = source && guidedReviewOf(ctx, source.sessionId, source.messageId);
      if (review) return c.json({ ...content, review });
    }
    return c.json(content);
  });

  api.get("/artifacts/:id/file", async (c) => {
    const file = library()?.store.figureFile(c.req.param("id"));
    const contentType = file && FIGURE_CONTENT_TYPES[file.ext];
    if (!file || !contentType) return c.json({ error: "No saved file" }, 404);
    try {
      // The full view the chat's image viewer uses: the same picture is converted once for both.
      const variant = await (ctx.localImageVariantStore ?? sharedLocalImageVariantStore()).getVariant(
        file.path,
        contentType,
        "full",
      );
      const bytes = await readFile(variant.path);
      return c.body(bytes, 200, {
        "Content-Type": variant.contentType,
        // Saved files are named by their content, so a given URL may change only to a newer figure.
        "Cache-Control": "private, max-age=60",
        // An SVG is shown as an image, never run as a page.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      });
    } catch {
      return c.json({ error: "No saved file" }, 404);
    }
  });

  /**
   * A small WebP of the newest version for the gallery. The URL names the version (`v`, from the
   * summary's `thumb`), so the browser keeps it for good and asks again only for a newer version.
   * A visual still being drawn answers 202 at once; the gallery asks again shortly.
   */
  api.get("/artifacts/:id/thumb", async (c) => {
    const theme = c.req.query("theme") === "light" ? "light" : "dark";
    // Never hold a request while a visual is drawn: browsers allow few requests at once per server.
    const data = await thumbnails()?.get(c.req.param("id"), theme, { waitForVisual: false });
    if (data === "pending") {
      return c.json({ pending: true }, 202, { "Retry-After": "2", "Cache-Control": "no-store" });
    }
    if (!data) return c.json({ error: "No thumbnail" }, 404);
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": "image/webp",
      "Cache-Control": c.req.query("v") ? "private, max-age=31536000, immutable" : "private, max-age=60",
    });
  });

  /** Rename (`title`) or star (`starred`); renaming updates the line under messages showing it. */
  api.patch("/artifacts/:id", async (c) => {
    const lib = library();
    const id = resolve(lib, c.req.param("id"));
    if (!lib || !id) return c.json({ error: "Artifact not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const renaming = body.title !== undefined;
    if (renaming && (typeof body.title !== "string" || !body.title.trim())) {
      return c.json({ error: "title must be a non-empty string" }, 400);
    }
    if (body.starred !== undefined && typeof body.starred !== "boolean") {
      return c.json({ error: "starred must be a boolean" }, 400);
    }
    if (!renaming && body.starred === undefined) return c.json({ error: "Nothing to change" }, 400);
    if (renaming) lib.store.rename(id, body.title);
    if (body.starred !== undefined) lib.store.setStarred(id, body.starred);
    await lib.store.flush();
    if (renaming) for (const sessionId of lib.store.sessionsShowingArtifact(id)) lib.refreshConversation(sessionId);
    return c.json(lib.store.get(id));
  });

  api.post("/artifacts/:id/merge", async (c) => {
    const lib = library();
    const body = await c.req.json().catch(() => ({}));
    if (!lib || typeof body.into !== "string") return c.json({ error: "into must name an artifact" }, 400);
    const from = resolve(lib, c.req.param("id"));
    const into = resolve(lib, body.into);
    const merged = from && into ? lib.store.merge(from, into) : null;
    if (!merged) return c.json({ error: "Both artifacts must exist, differ and be of the same kind" }, 400);
    await lib.store.flush();
    for (const sessionId of merged.affectedSessions) lib.refreshConversation(sessionId);
    return c.json(merged.artifact);
  });

  return api;
}

/** A leader and the sessions it herds (workers, reviewers), archived ones included. */
export function leaderFamily(ctx: RouteContext, leaderId: string): string[] {
  return [
    leaderId,
    ...ctx.launcher
      .listSessions()
      .filter((session) => session.herdedBy === leaderId)
      .map((session) => session.sessionId),
  ];
}

/**
 * A guided review's walkthrough, from the report message it was published in. Reviews are saved as
 * their Markdown only, so the Library reads the walkthrough (stops and their code) from history.
 */
function guidedReviewOf(ctx: RouteContext, sessionId: string, messageId: string): ArtifactGuidedReview | null {
  const history = ctx.wsBridge.getSession(sessionId)?.messageHistory ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.type !== "markdown_report" || message.id !== messageId || !message.guidedReview) continue;
    return {
      messageId: message.id,
      sessionId: message.source.sessionId,
      threadKey: message.threadKey || "main",
      ...(message.questId ? { questId: message.questId } : {}),
      meta: message.guidedReview,
    };
  }
  return null;
}
