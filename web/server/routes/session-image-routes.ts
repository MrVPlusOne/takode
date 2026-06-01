import type { Hono } from "hono";
import { deriveAttachmentPaths, formatAttachmentPathAnnotation } from "../attachment-paths.js";
import { getImageUploadSourceName, isSharpUnavailableError, SHARP_UNAVAILABLE_MESSAGE } from "../image-store.js";
import type { RouteContext } from "./context.js";

export function registerSessionImageRoutes(api: Hono, deps: Pick<RouteContext, "imageStore" | "resolveId">): void {
  const { imageStore, resolveId } = deps;

  api.post("/sessions/:id/images/prepare-user-message", async (c) => {
    if (!imageStore) return c.json({ error: "Image store not configured" }, 503);
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);

    const body = await c.req.json().catch(() => null);
    const images = Array.isArray((body as { images?: unknown[] } | null)?.images)
      ? ((body as { images: Array<{ mediaType?: unknown; data?: unknown; filename?: unknown }> }).images ?? [])
      : [];
    if (images.length === 0) {
      return c.json({ error: "images must be a non-empty array" }, 400);
    }

    const invalidImage = images.find(
      (img) => typeof img?.mediaType !== "string" || typeof img?.data !== "string" || !img.mediaType || !img.data,
    );
    if (invalidImage) {
      return c.json({ error: "Each image must include mediaType and data" }, 400);
    }

    let imageRefs;
    try {
      imageRefs = await Promise.all(
        images.map((img) =>
          imageStore.store(id, img.data as string, img.mediaType as string, getImageUploadSourceName(img)),
        ),
      );
    } catch (error) {
      if (isSharpUnavailableError(error)) {
        return c.json({ error: SHARP_UNAVAILABLE_MESSAGE }, 503);
      }
      throw error;
    }
    const paths = deriveAttachmentPaths(id, imageRefs);
    return c.json({
      imageRefs,
      paths,
      attachmentAnnotation: formatAttachmentPathAnnotation(paths),
    });
  });

  api.delete("/sessions/:id/images/:imageId", async (c) => {
    if (!imageStore) return c.json({ error: "Image store not configured" }, 503);
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const imageId = c.req.param("imageId");
    if (!imageId) return c.json({ error: "Missing imageId" }, 400);
    await imageStore.removeImage(id, imageId);
    return c.json({ ok: true });
  });

  api.get("/images/:sessionId/:imageId/thumb", async (c) => {
    if (!imageStore) return c.json({ error: "Image store not configured" }, 503);
    const { sessionId, imageId } = c.req.param();
    const thumbPath = await imageStore.getThumbnailPath(sessionId, imageId);
    const path = thumbPath || (await imageStore.getOriginalPath(sessionId, imageId));
    if (!path) return c.json({ error: "Image not found" }, 404);
    const file = Bun.file(path);
    return new Response(file, {
      headers: {
        "Content-Type": thumbPath ? "image/jpeg" : file.type || "application/octet-stream",
        "Cache-Control": thumbPath ? "public, max-age=31536000, immutable" : "no-store",
      },
    });
  });

  api.get("/images/:sessionId/:imageId/full", async (c) => {
    if (!imageStore) return c.json({ error: "Image store not configured" }, 503);
    const { sessionId, imageId } = c.req.param();
    const path = await imageStore.getOriginalPath(sessionId, imageId);
    if (!path) return c.json({ error: "Image not found" }, 404);
    const file = Bun.file(path);
    return new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
}
