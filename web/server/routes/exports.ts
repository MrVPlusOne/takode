/**
 * Export routes: a report or other card the browser built into a standalone HTML document,
 * printed by the server's headless Chrome as a PDF or captured as one long PNG.
 *
 * - `POST /api/exports/document` with `{ html, format: "pdf" | "png", width? }` returns the file.
 */
import { Hono } from "hono";
import type { VisualRenderer } from "../visual-renderer.js";

/** Largest document accepted; images are inlined into it, so it can be several megabytes. */
const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const DEFAULT_WIDTH = 800;

const CONTENT_TYPES = { pdf: "application/pdf", png: "image/png" } as const;

export function createExportRoutes(options: { renderer: Pick<VisualRenderer, "renderDocument"> }): Hono {
  const app = new Hono();

  app.post("/exports/document", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { html?: unknown; format?: unknown; width?: unknown } | null;
    if (!body || typeof body.html !== "string" || !body.html.trim()) return c.json({ error: "html is required" }, 400);
    if (body.format !== "pdf" && body.format !== "png") return c.json({ error: "format must be pdf or png" }, 400);
    if (body.html.length > MAX_DOCUMENT_BYTES) return c.json({ error: "The document is too large to export." }, 413);
    const width =
      typeof body.width === "number" && Number.isFinite(body.width)
        ? Math.min(1600, Math.max(320, Math.round(body.width)))
        : DEFAULT_WIDTH;
    try {
      const file = await options.renderer.renderDocument({ html: body.html, format: body.format, width });
      return new Response(new Uint8Array(file), { headers: { "Content-Type": CONTENT_TYPES[body.format] } });
    } catch (error) {
      return c.json({ error: `Export failed: ${(error as Error).message}` }, 503);
    }
  });

  return app;
}
