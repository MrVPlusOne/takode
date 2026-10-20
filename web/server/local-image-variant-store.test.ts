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

  it("serves the original pixels for the full view of an image that fits", async () => {
    // The full view is where people read screenshots: re-encoding them as JPEG or
    // shrinking them blurred small text, so an image within the size cap is served untouched.
    const sourcePath = join(tempDir, "full.png");
    await writeFile(sourcePath, await makePng(1600, 1200, 64));

    const full = await store.getVariant(sourcePath, "image/png", "full");

    expect(full.path).toBe(sourcePath);
    expect(full.contentType).toBe("image/png");
  });

  it("scales only oversized images down for the full view, keeping their format and caching the result", async () => {
    const sourcePath = join(tempDir, "huge.png");
    await writeFile(sourcePath, await makePng(5000, 400, 90));

    const full = await store.getVariant(sourcePath, "image/png", "full");
    expect(full.path).not.toBe(sourcePath);
    expect(full.contentType).toBe("image/png");
    const meta = await sharp(await readFile(full.path)).metadata();
    expect(meta).toMatchObject({ format: "png", width: 4096 });

    const reused = await store.getVariant(sourcePath, "image/png", "full");
    expect(reused.path).toBe(full.path);
    expect(reused.cacheHit).toBe(true);
  });

  it("shows the original behind an agent-readable copy in the full view", async () => {
    // Agents often link the reduced `.takode-agent.` JPEG they read themselves;
    // when the original capture sits beside it, people see that instead.
    const originalPath = join(tempDir, "shot.png");
    const agentCopyPath = join(tempDir, "shot.takode-agent.jpeg");
    await writeFile(originalPath, await makePng(860, 1864, 30));
    await writeFile(
      agentCopyPath,
      await sharp(await makePng(430, 932, 30))
        .jpeg()
        .toBuffer(),
    );

    const full = await store.getVariant(agentCopyPath, "image/jpeg", "full");
    expect(full).toMatchObject({ path: originalPath, contentType: "image/png" });

    // Thumbnails stay small either way, and a copy without its original is shown as it is.
    const thumbnail = await store.getVariant(agentCopyPath, "image/jpeg", "thumbnail");
    expect(thumbnail.contentType).toBe("image/jpeg");
    const loneCopyPath = join(tempDir, "lone.takode-agent.jpeg");
    await writeFile(loneCopyPath, await readFile(agentCopyPath));
    expect((await store.getVariant(loneCopyPath, "image/jpeg", "full")).path).toBe(loneCopyPath);
  });
});

async function makePng(width: number, height: number, value: number): Promise<Buffer> {
  return sharp(Buffer.alloc(width * height * 3, value), { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}
