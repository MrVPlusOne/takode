import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockRequireSharp = vi.hoisted(() => vi.fn());

vi.mock("./image-optimizer.js", () => ({
  requireSharp: mockRequireSharp,
  isSharpUnavailableError: vi.fn(() => false),
  createImageThumbnailBuffer: vi.fn(),
  fileExists: vi.fn(async () => false),
  optimizeImageBufferForStore: vi.fn(),
  AGENT_QUALITY: 85,
  MIME_TO_EXT: { "image/jpeg": "jpeg", "image/png": "png" },
  SHARP_UNAVAILABLE_MESSAGE: "sharp unavailable",
}));

import { createFilesystemRoutes } from "./routes/filesystem.js";

function makeApp(root: string) {
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
    mockRequireSharp.mockReset();
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

  it("hides Finder reveal behind a non-macOS server response", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const res = await makeApp(tempDir).request("/api/fs/file-link/reveal", {
      method: "POST",
      body: JSON.stringify({ path: tempDir, isRelative: false }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({
      error: "Open in Finder is only available on macOS servers",
    });
  });

  it("compresses image previews over one megabyte before delivery", async () => {
    await writeFile(join(tempDir, "preview.png"), Buffer.alloc(1024 * 1024 + 1, 1));
    const compressed = Buffer.from("compressed-preview");
    const pipeline = {
      rotate: vi.fn(() => pipeline),
      resize: vi.fn(() => pipeline),
      jpeg: vi.fn(() => pipeline),
      toBuffer: vi.fn(async () => compressed),
    };
    mockRequireSharp.mockResolvedValue(() => pipeline);

    const res = await makeApp(tempDir).request(
      `/api/fs/file-link/preview?path=${encodeURIComponent("preview.png")}&isRelative=1&sessionId=s1`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Takode-Preview-Compressed")).toBe("1");
    expect(Buffer.from(await res.arrayBuffer()).toString("utf-8")).toBe("compressed-preview");
  });
});
