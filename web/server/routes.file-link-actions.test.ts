import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./image-optimizer.js", () => ({
  isSharpUnavailableError: vi.fn(() => false),
  createImageThumbnailBuffer: vi.fn(),
  fileExists: vi.fn(async () => false),
  resizeImageBufferForStore: vi.fn(),
  TAKODE_AGENT_IMAGE_MARKER: ".takode-agent.",
  MIME_TO_EXT: { "image/jpeg": "jpeg", "image/png": "png" },
  SHARP_UNAVAILABLE_MESSAGE: "sharp unavailable",
}));

import { createFilesystemRoutes } from "./routes/filesystem.js";

function makeApp(
  root: string,
  localImageVariantStore?: { getVariant: (path: string, mimeType: string, variant: string) => Promise<unknown> },
) {
  const app = new Hono();
  app.route(
    "/api",
    createFilesystemRoutes({
      wsBridge: {
        getSession: vi.fn((sessionId: string) =>
          sessionId === "s1"
            ? {
                state: {
                  cwd: root,
                  repo_root: root,
                  is_worktree: false,
                },
              }
            : null,
        ),
      },
      execAsync: vi.fn(),
      execCaptureStdoutAsync: vi.fn(),
      ...(localImageVariantStore ? { localImageVariantStore } : {}),
    } as never),
  );
  return app;
}

describe("file-link filesystem actions", () => {
  let tempDir: string;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-link-actions-"));
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  });

  afterEach(async () => {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("resolves relative file-link paths against the session repo root", async () => {
    await mkdir(join(tempDir, "web", "src"), { recursive: true });
    await writeFile(join(tempDir, "web", "src", "app.ts"), "export const app = true;\n");

    const res = await makeApp(tempDir).request("/api/fs/file-link/resolve", {
      method: "POST",
      body: JSON.stringify({ path: "web/src/app.ts", isRelative: true, sessionId: "s1" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { absolutePath: string; exists: boolean; isFile: boolean; isImage: boolean };
    expect(body.absolutePath).toBe(join(tempDir, "web", "src", "app.ts"));
    expect(body.exists).toBe(true);
    expect(body.isFile).toBe(true);
    expect(body.isImage).toBe(false);
  });

  it("rejects relative file-link paths that escape the session root", async () => {
    const res = await makeApp(tempDir).request("/api/fs/file-link/resolve", {
      method: "POST",
      body: JSON.stringify({ path: "../outside.ts", isRelative: true, sessionId: "s1" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Relative file link escapes the session filesystem root",
    });
  });

  it("reports unsupported local folder open platforms", async () => {
    Object.defineProperty(process, "platform", { value: "aix", configurable: true });

    const res = await makeApp(tempDir).request("/api/fs/file-link/reveal", {
      method: "POST",
      body: JSON.stringify({ path: tempDir, isRelative: false }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({
      error: "Opening local folders is not supported on aix",
    });
  });

  it("serves stable image variant URLs with revalidating cache headers", async () => {
    const sourcePath = join(tempDir, "preview.png");
    const variantPath = join(tempDir, "variant.jpeg");
    await writeFile(sourcePath, Buffer.from("source"));
    await writeFile(variantPath, Buffer.from("variant"));
    const localImageVariantStore = {
      getVariant: vi.fn(async () => ({
        path: variantPath,
        contentType: "image/jpeg",
        cacheHit: true,
        etag: '"variant-v1"',
      })),
    };
    const app = makeApp(tempDir, localImageVariantStore);

    const fsImageRes = await app.request(`/api/fs/image?path=${encodeURIComponent(sourcePath)}&variant=thumbnail`);
    const fileLinkRes = await app.request(
      `/api/fs/file-link/image?path=${encodeURIComponent("preview.png")}&isRelative=1&sessionId=s1&variant=full`,
    );

    expect(fsImageRes.status).toBe(200);
    expect(fileLinkRes.status).toBe(200);
    for (const res of [fsImageRes, fileLinkRes]) {
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
      expect(res.headers.get("Cache-Control")).not.toContain("immutable");
      expect(res.headers.get("X-Takode-Image-Variant-Cache")).toBe("hit");
      expect(res.headers.get("ETag")).toBe('"variant-v1"');
    }
  });

  it("answers an image variant revalidation with a bodiless 304 while the variant is unchanged", async () => {
    // Stable path-based URLs must revalidate; the ETag keeps that from re-downloading
    // the image each time a browser mounts the same thumbnail again.
    const sourcePath = join(tempDir, "preview.png");
    const variantPath = join(tempDir, "variant.jpeg");
    await writeFile(sourcePath, Buffer.from("source"));
    await writeFile(variantPath, Buffer.from("variant"));
    const app = makeApp(tempDir, {
      getVariant: vi.fn(async () => ({ path: variantPath, contentType: "image/jpeg", cacheHit: true, etag: '"v1"' })),
    });
    const url = `/api/fs/image?path=${encodeURIComponent(sourcePath)}&variant=thumbnail`;

    const unchanged = await app.request(url, { headers: { "If-None-Match": '"v1"' } });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
    expect(unchanged.headers.get("ETag")).toBe('"v1"');

    // A changed source gets a new ETag, so the browser's stale tag gets the new bytes.
    const changed = await app.request(url, { headers: { "If-None-Match": '"v0"' } });
    expect(changed.status).toBe(200);
    expect(Buffer.from(await changed.arrayBuffer()).toString("utf-8")).toBe("variant");
  });
});
