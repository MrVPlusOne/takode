import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LocalImageVariantStore } from "./local-image-variant-store.js";

// Wraps the real encoder so tests can count encodes and hold one until they release it.
vi.mock("./image-optimizer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./image-optimizer.js")>();
  return { ...actual, optimizeImageBufferForStore: vi.fn(actual.optimizeImageBufferForStore) };
});
import * as imageOptimizer from "./image-optimizer.js";
import { makeIncompressibleJpeg, makeScreenshotLikePng, meanPixelDifference } from "./test-fixtures/images.js";

describe("LocalImageVariantStore", () => {
  let tempDir: string;
  let cacheDir: string;
  let store: LocalImageVariantStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "local-image-variants-"));
    cacheDir = join(tempDir, "cache");
    // Encodes here may be slow on a busy machine; these tests are about the variant, not the wait.
    store = new LocalImageVariantStore(cacheDir, { fullWaitMs: 60_000 });
  });

  afterEach(async () => {
    vi.mocked(imageOptimizer.optimizeImageBufferForStore).mockClear();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("generates persistent thumbnail variants and reuses them until the source changes", async () => {
    const sourcePath = join(tempDir, "source.png");
    await writeFile(sourcePath, await makePng(640, 420, 120));

    const first = await store.getVariant(sourcePath, "image/png", "thumbnail");
    expect(first.contentType).toBe("image/webp");
    expect(first.cacheHit).toBe(false);

    const firstMeta = await sharp(await readFile(first.path)).metadata();
    expect(firstMeta.width).toBeLessThanOrEqual(300);
    expect(firstMeta.height).toBeLessThanOrEqual(300);

    const reused = await store.getVariant(sourcePath, "image/png", "thumbnail");
    expect(reused.path).toBe(first.path);
    expect(reused.cacheHit).toBe(true);
    // The ETag follows the variant, so browsers can revalidate without re-downloading.
    expect(reused.etag).toBe(first.etag);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(sourcePath, await makePng(640, 420, 210));

    const regenerated = await store.getVariant(sourcePath, "image/png", "thumbnail");
    expect(regenerated.path).not.toBe(first.path);
    expect(regenerated.cacheHit).toBe(false);
    expect(regenerated.etag).not.toBe(first.etag);
  });

  it("re-encodes a screenshot for the full view as near-lossless WebP: smaller, same size, nearly identical pixels", async () => {
    // The full view is where people read screenshots. Near-lossless WebP keeps small
    // text crisp (JPEG smeared it) while sending far fewer bytes than the PNG.
    const sourcePath = join(tempDir, "screenshot.png");
    const source = await makeScreenshotLikePng(1600, 1200);
    await writeFile(sourcePath, source);

    const full = await store.getVariant(sourcePath, "image/png", "full");

    expect(full.contentType).toBe("image/webp");
    const encoded = await readFile(full.path);
    expect(encoded.length).toBeLessThan(source.length);
    expect(await sharp(encoded).metadata()).toMatchObject({ format: "webp", width: 1600, height: 1200 });
    expect(await meanPixelDifference(source, encoded)).toBeLessThan(2);
  });

  it("scales oversized images down to 4096 px for the full view and caches the result", async () => {
    const sourcePath = join(tempDir, "huge.png");
    await writeFile(sourcePath, await makeScreenshotLikePng(5000, 400));

    const full = await store.getVariant(sourcePath, "image/png", "full");
    expect(await sharp(await readFile(full.path)).metadata()).toMatchObject({ format: "webp", width: 4096 });

    const reused = await store.getVariant(sourcePath, "image/png", "full");
    expect(reused.path).toBe(full.path);
    expect(reused.cacheHit).toBe(true);
  });

  it("serves the original when re-encoding would not make it smaller", async () => {
    // A heavily compressed JPEG is already smaller than a high-quality WebP of it.
    const sourcePath = join(tempDir, "photo.jpeg");
    await writeFile(sourcePath, await makeIncompressibleJpeg(400, 300));

    const full = await store.getVariant(sourcePath, "image/jpeg", "full");

    expect(full).toMatchObject({ path: sourcePath, contentType: "image/jpeg" });
  });

  it("shows the original behind an agent-readable copy in the full view", async () => {
    // Agents often link the reduced `.takode-agent.` JPEG they read themselves;
    // when the original capture sits beside it, people see that instead.
    const originalPath = join(tempDir, "shot.png");
    const agentCopyPath = join(tempDir, "shot.takode-agent.jpeg");
    await writeFile(originalPath, await makeScreenshotLikePng(860, 1864));
    await writeFile(
      agentCopyPath,
      await sharp(await makeScreenshotLikePng(430, 932))
        .jpeg()
        .toBuffer(),
    );

    const full = await store.getVariant(agentCopyPath, "image/jpeg", "full");
    expect(await sharp(await readFile(full.path)).metadata()).toMatchObject({ width: 860, height: 1864 });

    // Thumbnails stay small either way, and a copy without its original is shown from the copy.
    const thumbnail = await store.getVariant(agentCopyPath, "image/jpeg", "thumbnail");
    expect(thumbnail.contentType).toBe("image/webp");
    const loneCopyPath = join(tempDir, "lone.takode-agent.jpeg");
    await writeFile(loneCopyPath, await readFile(agentCopyPath));
    const lone = await store.getVariant(loneCopyPath, "image/jpeg", "full");
    expect(await sharp(await readFile(lone.path)).metadata()).toMatchObject({ width: 430, height: 932 });
  });

  it("sends the original when the full view is not ready in time, and the encoded copy on later opens", async () => {
    // Near-lossless WebP of a large screenshot takes seconds and the browser receives
    // nothing meanwhile; the original starts downloading at once instead.
    const encoder = vi.mocked(imageOptimizer.optimizeImageBufferForStore);
    const actualEncode = encoder.getMockImplementation()!;
    let release!: () => void;
    const released = new Promise<void>((resolveRelease) => (release = resolveRelease));
    encoder.mockImplementationOnce(async (...args) => {
      await released;
      return actualEncode(...args);
    });
    const quickStore = new LocalImageVariantStore(cacheDir, { fullWaitMs: 20 });
    const sourcePath = join(tempDir, "screenshot.png");
    await writeFile(sourcePath, await makeScreenshotLikePng(1600, 1200));

    const first = await quickStore.getVariant(sourcePath, "image/png", "full");
    expect(first).toMatchObject({ path: sourcePath, contentType: "image/png" });

    // A second open while the encode runs joins it instead of starting another.
    const second = await quickStore.getVariant(sourcePath, "image/png", "full");
    expect(second).toMatchObject({ path: sourcePath, etag: first.etag });
    expect(encoder).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(async () => {
      const later = await quickStore.getVariant(sourcePath, "image/png", "full");
      expect(later).toMatchObject({ contentType: "image/webp", cacheHit: true });
      // A browser holding the original revalidates with its own ETag, so it gets the smaller copy.
      expect(later.etag).not.toBe(first.etag);
    }, 30_000);
    expect(encoder).toHaveBeenCalledTimes(1);
  });

  it("shares one encode between simultaneous requests for the same image", async () => {
    const encoder = vi.mocked(imageOptimizer.optimizeImageBufferForStore);
    const sourcePath = join(tempDir, "screenshot.png");
    await writeFile(sourcePath, await makeScreenshotLikePng(800, 600));

    const variants = await Promise.all([1, 2, 3].map(() => store.getVariant(sourcePath, "image/png", "full")));

    expect(new Set(variants.map((variant) => variant.path)).size).toBe(1);
    expect(variants[0]?.contentType).toBe("image/webp");
    expect(encoder).toHaveBeenCalledTimes(1);
  });
});

async function makePng(width: number, height: number, value: number): Promise<Buffer> {
  return sharp(Buffer.alloc(width * height * 3, value), { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}
