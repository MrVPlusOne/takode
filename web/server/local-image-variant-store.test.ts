import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LocalImageVariantStore } from "./local-image-variant-store.js";

describe("LocalImageVariantStore", () => {
  let tempDir: string;
  let cacheDir: string;
  let store: LocalImageVariantStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "local-image-variants-"));
    cacheDir = join(tempDir, "cache");
    store = new LocalImageVariantStore(cacheDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("generates persistent thumbnail variants and reuses them until the source changes", async () => {
    const sourcePath = join(tempDir, "source.png");
    await writeFile(sourcePath, await makePng(640, 420, 120));

    const first = await store.getVariant(sourcePath, "image/png", "thumbnail");
    expect(first.contentType).toBe("image/jpeg");
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
    await writeFile(
      sourcePath,
      await sharp(await makeNoisePng(400, 300))
        .jpeg({ quality: 30 })
        .toBuffer(),
    );

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
    expect(thumbnail.contentType).toBe("image/jpeg");
    const loneCopyPath = join(tempDir, "lone.takode-agent.jpeg");
    await writeFile(loneCopyPath, await readFile(agentCopyPath));
    const lone = await store.getVariant(loneCopyPath, "image/jpeg", "full");
    expect(await sharp(await readFile(lone.path)).metadata()).toMatchObject({ width: 430, height: 932 });
  });
});

async function makePng(width: number, height: number, value: number): Promise<Buffer> {
  return sharp(Buffer.alloc(width * height * 3, value), { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** Flat panels with thin dark lines, roughly like UI text rows: PNG-friendly, as screenshots are. */
async function makeScreenshotLikePng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3, 245);
  for (let y = 0; y < height; y++) {
    if (y % 18 >= 2) continue;
    for (let x = 0; x < width; x++) {
      if (x % 9 < 6) pixels.fill(40 + (x % 120), (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** Deterministic noise, which no encoder compresses well. */
async function makeNoisePng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = seed >> 23;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function meanPixelDifference(left: Buffer, right: Buffer): Promise<number> {
  const a = await sharp(left).removeAlpha().raw().toBuffer();
  const b = await sharp(right).removeAlpha().raw().toBuffer();
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}
