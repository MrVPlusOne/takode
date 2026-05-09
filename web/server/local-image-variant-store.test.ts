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

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(sourcePath, await makePng(640, 420, 210));

    const regenerated = await store.getVariant(sourcePath, "image/png", "thumbnail");
    expect(regenerated.path).not.toBe(first.path);
    expect(regenerated.cacheHit).toBe(false);
  });

  it("generates reusable full display variants using the shared store optimization policy", async () => {
    const sourcePath = join(tempDir, "full.png");
    await writeFile(sourcePath, await makePng(800, 600, 64));

    const full = await store.getVariant(sourcePath, "image/png", "full");
    expect(full.contentType).toBe("image/jpeg");
    expect(full.cacheHit).toBe(false);

    const reused = await store.getVariant(sourcePath, "image/png", "full");
    expect(reused.path).toBe(full.path);
    expect(reused.contentType).toBe("image/jpeg");
    expect(reused.cacheHit).toBe(true);
  });
});

async function makePng(width: number, height: number, value: number): Promise<Buffer> {
  return sharp(Buffer.alloc(width * height * 3, value), { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}
