import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./image-optimizer.js", () => ({
  isSharpUnavailableError: vi.fn(() => false),
  createImageThumbnailBuffer: vi.fn(),
  fileExists: vi.fn(async () => false),
  optimizeImageBufferForStore: vi.fn(),
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
            : sessionId === "wt"
              ? {
                  state: {
                    cwd: join(root, ".companion", "worktrees", "repo", "repo-wt-2"),
                    repo_root: join(root, "repo"),
                    is_worktree: true,
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

  // File links open in Takode's viewer, which reads files on the machine that holds them through these routes.
  const get = (path: string, query: Record<string, string>) =>
    makeApp(tempDir).request(`/api${path}?${new URLSearchParams(query)}`);

  it("follows a link into a worktree that is gone to the same file in the session's current worktree", async () => {
    // Agents link files in their own worktree; a later session reads them from its own checkout.
    const current = join(tempDir, ".companion", "worktrees", "repo", "repo-wt-2", "web");
    await mkdir(current, { recursive: true });
    await writeFile(join(current, "a.ts"), "export const a = 1;\n");
    const stale = join(tempDir, ".companion", "worktrees", "repo", "repo-wt-1", "web", "a.ts");

    const res = await get("/fs/file-link/text", { path: stale, isRelative: "0", sessionId: "wt" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      absolutePath: join(current, "a.ts"),
      content: "export const a = 1;\n",
    });
  });

  it("resolves a relative link in a worktree session against that worktree, not the main checkout", async () => {
    // A worker's links name files in its own checkout, which can differ from the main one.
    const worktree = join(tempDir, ".companion", "worktrees", "repo", "repo-wt-2", "web");
    const main = join(tempDir, "repo", "web");
    await mkdir(worktree, { recursive: true });
    await mkdir(main, { recursive: true });
    await writeFile(join(worktree, "b.ts"), "worktree\n");
    await writeFile(join(main, "b.ts"), "main\n");

    const res = await get("/fs/file-link/text", { path: "web/b.ts", isRelative: "1", sessionId: "wt" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ absolutePath: join(worktree, "b.ts"), content: "worktree\n" });
  });

  it("falls back to the main checkout when a gone worktree's file is not in the session's worktree", async () => {
    // A file that exists only in the main checkout (not yet in this worktree) is still found.
    const main = join(tempDir, "repo", "web");
    await mkdir(main, { recursive: true });
    await writeFile(join(main, "c.ts"), "main only\n");
    const stale = join(tempDir, ".companion", "worktrees", "repo", "repo-wt-1", "web", "c.ts");

    const res = await get("/fs/file-link/text", { path: stale, isRelative: "0", sessionId: "wt" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ absolutePath: join(main, "c.ts"), content: "main only\n" });
  });

  it("lists a linked folder, folders first, without hidden entries", async () => {
    await mkdir(join(tempDir, "shots", "older"), { recursive: true });
    await writeFile(join(tempDir, "shots", "b.png"), "png");
    await writeFile(join(tempDir, "shots", "a.log"), "log line\n");
    await writeFile(join(tempDir, "shots", ".DS_Store"), "");

    const res = await get("/fs/file-link/folder", { path: join(tempDir, "shots"), isRelative: "0" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ name: string; isDirectory: boolean; size: number }> };
    expect(body.entries.map((entry) => [entry.name, entry.isDirectory, entry.size])).toEqual([
      ["older", true, 0],
      ["a.log", false, 9],
      ["b.png", false, 3],
    ]);

    const file = await get("/fs/file-link/folder", { path: join(tempDir, "shots", "a.log"), isRelative: "0" });
    expect(file.status).toBe(400);
  });

  it("says a file is binary or too large instead of sending it as text", async () => {
    // The viewer shows "Takode can't show this kind of file" with the size the server reports.
    await writeFile(join(tempDir, "model.bin"), Buffer.from([1, 2, 0, 3]));
    const binary = await get("/fs/file-link/text", { path: join(tempDir, "model.bin"), isRelative: "0" });
    expect(binary.status).toBe(415);
    await expect(binary.json()).resolves.toMatchObject({ error: "Not a text file", size: 4 });

    await writeFile(join(tempDir, "big.log"), "x".repeat(2 * 1024 * 1024 + 1));
    const big = await get("/fs/file-link/text", { path: join(tempDir, "big.log"), isRelative: "0" });
    expect(big.status).toBe(413);
    await expect(big.json()).resolves.toMatchObject({ size: 2 * 1024 * 1024 + 1 });
  });

  it("serves a linked PDF inline for the browser's viewer, and nothing else", async () => {
    await writeFile(join(tempDir, "report.pdf"), "%PDF-1.4 test");
    await writeFile(join(tempDir, "notes.txt"), "secret");

    const pdf = await get("/fs/file-link/pdf", { path: join(tempDir, "report.pdf"), isRelative: "0" });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain("inline");
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await pdf.text()).toBe("%PDF-1.4 test");

    // Raw bytes are served only for PDFs, so the route can't be used to load other files as pages.
    expect((await get("/fs/file-link/pdf", { path: join(tempDir, "notes.txt"), isRelative: "0" })).status).toBe(400);
    expect((await get("/fs/file-link/pdf", { path: join(tempDir, "gone.pdf"), isRelative: "0" })).status).toBe(404);
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
