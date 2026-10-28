/**
 * Visual block routes.
 *
 * - `GET /visual-kit/lib/:file` serves the diagram and chart helper libraries that
 *   visual frames load. Frames have an opaque origin and send no login cookie, so this
 *   path is public, like the rest of the frontend bundle.
 * - `POST /api/visuals/snapshot` renders a visual on the server and returns it without
 *   scripts, for browsers that can't isolate a visual's scripts from the page.
 * - `POST /api/visuals/preview` renders it at phone and desktop width in both themes,
 *   with screenshots and checks, for `takode visual preview`.
 * - `POST /api/visuals/image` renders it at desktop width and returns the PNG, for export.
 */
import { Hono } from "hono";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import {
  parseVisualBlock,
  VISUAL_MAX_ELEMENTS,
  VISUAL_MAX_SNAPSHOT_BYTES,
  VISUAL_MAX_SOURCE_BYTES,
  type VisualTheme,
} from "../../shared/visual-block.js";
import type { VisualRenderer, VisualRenderResult } from "../visual-renderer.js";

/** Helper files a frame may load, and where each package ships its browser build. */
const HELPER_FILES: Record<string, { pkg: string; path: string }> = {
  "mermaid.min.js": { pkg: "mermaid", path: "dist/mermaid.min.js" },
  "vega.min.js": { pkg: "vega", path: "build/vega.min.js" },
  "vega-lite.min.js": { pkg: "vega-lite", path: "build/vega-lite.min.js" },
  "vega-embed.min.js": { pkg: "vega-embed", path: "build/vega-embed.min.js" },
};

const gzip = promisify(gzipCallback);

/** Feed column widths the preview renders at: a phone's message column and a desktop one. */
export const VISUAL_PREVIEW_WIDTHS = { phone: 398, desktop: 760 } as const;

export interface VisualCheck {
  level: "ok" | "warn" | "error";
  text: string;
}

export function createVisualRoutes(options: { renderer: VisualRenderer }): Hono {
  const app = new Hono();
  // Read and compressed once per file; Mermaid alone is several megabytes.
  const helpers = new Map<string, Promise<{ plain: Buffer; gzipped: Buffer } | null>>();

  app.get("/visual-kit/lib/:file", async (c) => {
    const file = c.req.param("file");
    if (!Object.hasOwn(HELPER_FILES, file)) return c.text("Not found", 404);
    if (!helpers.has(file)) helpers.set(file, loadHelper(file));
    const helper = await helpers.get(file)!;
    if (!helper) return c.text("Not found", 404);
    const gzipped = /\bgzip\b/.test(c.req.header("Accept-Encoding") ?? "");
    return new Response(new Uint8Array(gzipped ? helper.gzipped : helper.plain), {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
        Vary: "Accept-Encoding",
        ...(gzipped ? { "Content-Encoding": "gzip" } : {}),
      },
    });
  });

  app.post("/api/visuals/snapshot", async (c) => {
    const body = await readBody(c.req.raw);
    if ("error" in body) return c.json({ error: body.error }, 400);
    const width = clampWidth(body.width);
    const result = await options.renderer.render({ source: body.source, theme: body.theme, width, snapshot: true });
    // A visual too big to draw is reported, not shipped: the browser shows its text instead.
    const tooBig =
      result.elementCount > VISUAL_MAX_ELEMENTS ||
      (result.snapshotHtml !== undefined && result.snapshotHtml.length > VISUAL_MAX_SNAPSHOT_BYTES);
    const { snapshotHtml, ...rest } = withoutScreenshot(result);
    return c.json(tooBig ? { ...rest, tooLarge: true } : { ...rest, snapshotHtml });
  });

  app.post("/api/visuals/image", async (c) => {
    const body = await readBody(c.req.raw);
    if ("error" in body) return c.json({ error: body.error }, 400);
    const result = await options.renderer.render({
      source: body.source,
      theme: body.theme,
      width: VISUAL_PREVIEW_WIDTHS.desktop,
      screenshot: true,
    });
    if (result.status !== "ok" || !result.screenshotPng) {
      return c.json({ error: `The visual didn't render (${result.detail ?? result.status}).` }, 503);
    }
    return new Response(new Uint8Array(Buffer.from(result.screenshotPng, "base64")), {
      headers: { "Content-Type": "image/png" },
    });
  });

  app.post("/api/visuals/preview", async (c) => {
    const body = await readBody(c.req.raw);
    if ("error" in body) return c.json({ error: body.error }, 400);
    const renders: Array<VisualRenderResult & { label: "phone" | "desktop" }> = [];
    for (const [label, width] of Object.entries(VISUAL_PREVIEW_WIDTHS) as Array<["phone" | "desktop", number]>) {
      for (const theme of ["dark", "light"] as const) {
        renders.push({
          label,
          ...(await options.renderer.render({ source: body.source, theme, width, screenshot: true })),
        });
      }
    }
    return c.json({ renders, checks: checkVisual(body.source, renders) });
  });

  return app;
}

/** What an agent should fix before publishing, judged from the rendered results. */
export function checkVisual(
  source: string,
  renders: Array<VisualRenderResult & { label: "phone" | "desktop" }>,
): VisualCheck[] {
  const checks: VisualCheck[] = [];
  const block = parseVisualBlock(source);
  checks.push(
    block.alt
      ? { level: "ok", text: "Has alt text for read aloud, Copy for Slack and search." }
      : {
          level: "warn",
          text: "No `alt:` line. Add a plain-text version: read aloud, Copy for Slack and search use it.",
        },
  );
  const failed = renders.find((render) => render.status !== "ok");
  if (failed) {
    checks.push({
      level: "error",
      text: `Didn't render (${failed.status}${failed.detail ? `: ${failed.detail}` : ""}). Takode won't show it.`,
    });
    return checks;
  }
  const phone = renders.find((render) => render.label === "phone")!;
  const errors = [...new Set(renders.flatMap((render) => render.errors))];
  checks.push(
    errors.length
      ? { level: "error", text: `Script errors: ${errors.join(" | ")}` }
      : { level: "ok", text: "No script errors." },
  );
  if (phone.contentWidth > phone.width + 2) {
    checks.push({
      level: "warn",
      text: `On a phone the content is ${phone.contentWidth}px wide in a ${phone.width}px column, so it scrolls sideways. Prefer kit shapes or a top-to-bottom layout.`,
    });
  }
  const smallest = Math.min(...renders.map((render) => render.smallestTextPx ?? Infinity));
  if (smallest < 11) {
    checks.push({
      level: "warn",
      text: `Smallest text is ${smallest}px; keep text at 11px or more (wide diagrams shrink).`,
    });
  }
  if (phone.elementCount > VISUAL_MAX_ELEMENTS) {
    checks.push({ level: "error", text: `${phone.elementCount} elements: too many, phones won't show it.` });
  }
  if (phone.height > 2400) {
    checks.push({
      level: "warn",
      text: `${phone.height}px tall on a phone; the feed cuts it at 2,400px behind Show all.`,
    });
  }
  const slowest = Math.max(...renders.map((render) => render.settleMs));
  if (slowest > 2500) checks.push({ level: "warn", text: `Took ${slowest}ms to settle; phones will be slower.` });
  return checks;
}

async function readBody(
  request: Request,
): Promise<{ source: string; theme: VisualTheme; width?: number } | { error: string }> {
  const body = (await request.json().catch(() => null)) as {
    source?: unknown;
    theme?: unknown;
    width?: unknown;
  } | null;
  if (!body || typeof body.source !== "string" || !body.source.trim()) return { error: "source is required" };
  if (new TextEncoder().encode(body.source).length > VISUAL_MAX_SOURCE_BYTES) {
    return { error: `visual source is over ${VISUAL_MAX_SOURCE_BYTES / 1024} KB` };
  }
  return {
    source: body.source,
    theme: body.theme === "light" ? "light" : "dark",
    width: typeof body.width === "number" ? body.width : undefined,
  };
}

async function loadHelper(file: string): Promise<{ plain: Buffer; gzipped: Buffer } | null> {
  const { pkg, path } = HELPER_FILES[file]!;
  try {
    const root = dirname(createRequire(import.meta.url).resolve(`${pkg}/package.json`));
    const plain = await readFile(join(root, path));
    return { plain, gzipped: await gzip(plain) };
  } catch (error) {
    console.error(`[visuals] Helper ${file} is unavailable:`, error);
    return null;
  }
}

function clampWidth(width: number | undefined): number {
  return Math.min(1600, Math.max(240, Math.round(width ?? VISUAL_PREVIEW_WIDTHS.desktop)));
}

function withoutScreenshot(result: VisualRenderResult): Omit<VisualRenderResult, "screenshotPng"> {
  const { screenshotPng: _screenshot, ...rest } = result;
  return rest;
}
