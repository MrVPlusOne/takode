import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import {
  ARTIFACT_KINDS,
  type ArtifactGuidedReview,
  type ArtifactKind,
  type ArtifactListQuery,
} from "../../shared/artifact-library.js";
import { normalizeThreadTarget } from "../../shared/thread-routing.js";
import { getArtifactLibrary, type ArtifactLibrary } from "../artifact-library.js";
import { readPptxSlides } from "../pptx-slides.js";
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
 * A published deck's largest file, and its slide pictures' (each and in all). Together they stay
 * under the 128 MB a request may carry through a host's API proxy (Bun's default).
 */
const MAX_PPTX_BYTES = 64 * 1024 * 1024;
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const MAX_PICTURES_BYTES = 60 * 1024 * 1024;
const PICTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

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
    const source = lib.store.get(id!)?.versions.find((version) => version.n === n)?.source;
    if (content.kind === "review") {
      const review = source && guidedReviewOf(ctx, source.sessionId, source.messageId);
      if (review) return c.json({ ...content, review });
    }
    if (content.kind === "report" && source) {
      return c.json({ ...content, message: { sessionId: source.sessionId, messageId: source.messageId } });
    }
    return c.json(content);
  });

  /**
   * `takode artifact publish`: a session publishes a PowerPoint deck (`file`) with an optional
   * `title` and `threadKey`, and optionally one picture per slide (`pictures`, in order). It is
   * saved as a slide deck, a new version of the deck with that title in the session's space.
   */
  api.post("/artifacts/publish", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const lib = library();
    if (!lib) return c.json({ error: "The Library is not running." }, 503);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "Send the deck as a multipart form." }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File) || !/\.pptx$/i.test(file.name)) {
      return c.json({ error: "Publish a PowerPoint file (.pptx)." }, 400);
    }
    if (file.size > MAX_PPTX_BYTES) {
      return c.json(
        { error: `The file is ${megabytes(file.size)}; the Library takes up to ${megabytes(MAX_PPTX_BYTES)}.` },
        413,
      );
    }
    const target = normalizeThreadTarget(String(form.get("threadKey") ?? "main"));
    if (!target) return c.json({ error: "Name a thread as q-N, t-N or main." }, 400);
    const pictureFiles = form.getAll("pictures").filter((entry): entry is File => entry instanceof File);
    const badPicture = pictureFiles.find((picture) => !PICTURE_EXTENSIONS.has(extensionOf(picture.name)));
    if (badPicture) return c.json({ error: `Slide pictures must be PNG, JPEG or WebP: ${badPicture.name}` }, 400);
    const total = pictureFiles.reduce((sum, picture) => sum + picture.size, 0);
    if (pictureFiles.some((picture) => picture.size > MAX_PICTURE_BYTES) || total > MAX_PICTURES_BYTES) {
      return c.json({ error: "The slide pictures are too large; render them at a smaller size." }, 413);
    }
    const data = new Uint8Array(await file.arrayBuffer());
    let slides: ReturnType<typeof readPptxSlides>;
    try {
      slides = readPptxSlides(data);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Could not read the .pptx file." }, 400);
    }
    if (pictureFiles.length > 0 && pictureFiles.length !== slides.length) {
      return c.json(
        {
          error:
            `The deck shows ${slides.length} slide(s) but ${pictureFiles.length} picture(s) were sent; ` +
            "send one picture per shown slide, in order, or none.",
        },
        400,
      );
    }
    const titleField = form.get("title");
    // Versions group by title, so the default is the file's name, which stays put between revisions.
    const title = (typeof titleField === "string" && titleField.trim()) || fileTitle(file.name);
    const result = await lib.publishPptx(auth.callerId, target.threadKey, {
      title: title.slice(0, 200),
      name: file.name.split(/[\\/]/).pop() || file.name,
      data,
      slides,
      pictures: await Promise.all(
        pictureFiles.map(async (picture) => ({
          data: new Uint8Array(await picture.arrayBuffer()),
          ext: extensionOf(picture.name),
        })),
      ),
    });
    return c.json({ ...lib.store.get(result.artifactId), version: result.n, added: result.added }, 201);
  });

  /** A published deck version's file, saved under its original name. */
  api.get("/artifacts/:id/versions/:n/file", async (c) => {
    const lib = library();
    const id = resolve(lib, c.req.param("id"));
    const n = Number(c.req.param("n"));
    const file = lib && id && Number.isInteger(n) ? await lib.store.pptxFile(id, n) : null;
    if (!file) return c.json({ error: "No saved file" }, 404);
    try {
      return c.body(new Uint8Array(await readFile(file.path)), 200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, max-age=31536000, immutable",
      });
    } catch {
      return c.json({ error: "No saved file" }, 404);
    }
  });

  /** A published deck version's picture of one slide (1-based). */
  api.get("/artifacts/:id/versions/:n/slides/:slide", async (c) => {
    const lib = library();
    const id = resolve(lib, c.req.param("id"));
    const n = Number(c.req.param("n"));
    const slide = Number(c.req.param("slide"));
    const picture =
      lib && id && Number.isInteger(n) && Number.isInteger(slide) ? await lib.store.pptxPicture(id, n, slide) : null;
    const contentType = picture && FIGURE_CONTENT_TYPES[picture.ext];
    if (!picture || !contentType) return c.json({ error: "No slide picture" }, 404);
    try {
      return c.body(new Uint8Array(await readFile(picture.path)), 200, {
        "Content-Type": contentType,
        // A version's pictures never change.
        "Cache-Control": "private, max-age=31536000, immutable",
      });
    } catch {
      return c.json({ error: "No slide picture" }, 404);
    }
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

  /**
   * Rename (`title`) or star (`starred`). Conversations showing the artifact are refreshed: a new
   * title shows on its cards, and a star in their More menus (Star or Unstar).
   */
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
    for (const sessionId of lib.store.sessionsShowingArtifact(id)) lib.refreshConversation(sessionId);
    return c.json(lib.store.get(id));
  });

  /**
   * The user copied parts (0-based) of a post version: recorded so every device shows them as
   * copied, and conversations showing the post are refreshed.
   */
  api.post("/artifacts/:id/versions/:n/copied", async (c) => {
    const lib = library();
    const id = resolve(lib, c.req.param("id"));
    const n = Number(c.req.param("n"));
    if (!lib || !id || !Number.isInteger(n)) return c.json({ error: "Version not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (!Array.isArray(body.parts) || !body.parts.every((part: unknown) => Number.isInteger(part))) {
      return c.json({ error: "parts must be a list of part numbers" }, 400);
    }
    if (!lib.store.markCopied(id, n, body.parts)) return c.json({ error: "Version not found" }, 404);
    await lib.store.flush();
    for (const sessionId of lib.store.sessionsShowingArtifact(id)) lib.refreshConversation(sessionId);
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

function extensionOf(name: string): string {
  return /\.[a-z0-9]+$/i.exec(name)?.[0]?.toLowerCase() ?? "";
}

/** A deck's title from its file name when it has none: "fv_weekly-2026.pptx" reads "Fv weekly 2026". */
function fileTitle(name: string): string {
  const words = (name.split(/[\\/]/).pop() ?? name)
    .replace(/\.pptx$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Slides";
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
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
