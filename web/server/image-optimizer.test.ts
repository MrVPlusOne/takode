import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import {
  buildTakodeAgentImagePath,
  isTakodeAgentOptimizedPath,
  optimizeAgentImageFile,
  optimizeImageBufferForStore,
  resetSharpLoaderForTest,
} from "./image-optimizer.js";
import {
  makeAnimatedGif,
  makeIncompressibleJpeg,
  makeNoisePng,
  makeScreenshotLikePng,
  meanPixelDifference,
} from "./test-fixtures/images.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "image-optimizer-test-"));
});

afterEach(() => {
  resetSharpLoaderForTest();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("optimizeImageBufferForStore", () => {
  it("encodes screenshots as near-lossless WebP: smaller, same size, nearly identical pixels", async () => {
    // Chat uploads, quest attachments, agent copies and the viewer share this policy.
    // Near-lossless keeps small text crisp, where JPEG smeared it and added colour fringes.
    const png = await makeScreenshotLikePng(900, 700);

    const result = await optimizeImageBufferForStore(png, "image/png");

    expect(result).toMatchObject({ mediaType: "image/webp", reencoded: true, resized: false });
    expect(result.data.length).toBeLessThan(png.length);
    expect(await sharp(result.data).metadata()).toMatchObject({ format: "webp", width: 900, height: 700 });
    expect(await meanPixelDifference(png, result.data)).toBeLessThan(2);
  });

  it("encodes photo-like sources as quality-90 WebP rather than near-lossless", async () => {
    // Near-lossless would keep a JPEG's noise and grow the file, so lossy sources take the lossy encode.
    const jpeg = await sharp(await makeNoisePng(600, 400))
      .blur(2)
      .jpeg({ quality: 95 })
      .toBuffer();
    const lossy = await sharp(jpeg).webp({ quality: 90 }).toBuffer();

    const result = await optimizeImageBufferForStore(jpeg, "image/jpeg");

    expect(result.mediaType).toBe("image/webp");
    expect(result.data.equals(lossy)).toBe(true);
  });

  it("falls back to quality-90 WebP when a near-lossless encode would be over 2 MB", async () => {
    // Photo-like PNGs are huge as near-lossless WebP; the cap keeps stored copies small and
    // far inside model providers' per-image limits.
    const png = await makeNoisePng(1000, 1000);
    const lossy = await sharp(png).webp({ quality: 90 }).toBuffer();

    const result = await optimizeImageBufferForStore(png, "image/png");

    expect(result.mediaType).toBe("image/webp");
    expect(result.data.equals(lossy)).toBe(true);
  });

  it("uses actual image metadata instead of the declared MIME type", async () => {
    // A screenshot producer can write JPEG bytes to a .png path. The optimizer
    // must inspect bytes and avoid treating extension or declared MIME as truth.
    const jpeg = await makeIncompressibleJpeg(320, 240);

    const result = await optimizeImageBufferForStore(jpeg, "image/png");

    expect(result.mediaType).toBe("image/jpeg");
    expect(result.reencoded).toBe(false);
    expect(result.data).toBe(jpeg);
  });

  it("keeps animated images unchanged", async () => {
    // Re-encoding would keep only the first frame.
    const gif = await makeAnimatedGif(40, 30);

    const result = await optimizeImageBufferForStore(gif, "image/gif");

    expect(result).toMatchObject({ mediaType: "image/gif", reencoded: false });
    expect(result.data).toBe(gif);
  });
});

describe("optimizeAgentImageFile", () => {
  it("preserves the original and writes a .takode-agent WebP sibling", async () => {
    const inputPath = join(tempDir, "screenshot.png");
    const png = await sharp({
      create: { width: 2600, height: 1800, channels: 4, background: { r: 0, g: 80, b: 120, alpha: 1 } },
    })
      .png()
      .toBuffer();
    await writeFile(inputPath, png);

    const result = await optimizeAgentImageFile(inputPath);
    const output = await readFile(result.outputPath);
    const meta = await sharp(output).metadata();

    expect(result.inputPath).toBe(inputPath);
    expect(result.outputPath).toBe(buildTakodeAgentImagePath(inputPath, "image/webp"));
    expect(result.outputPath.endsWith("screenshot.takode-agent.webp")).toBe(true);
    expect(result.wroteOutput).toBe(true);
    expect(result.resized).toBe(true);
    expect(result.reencoded).toBe(true);
    expect(existsSync(inputPath)).toBe(true);
    expect(meta.format).toBe("webp");
    expect(meta.width).toBeLessThanOrEqual(1920);
    expect(meta.height).toBeLessThanOrEqual(1920);
  });

  it("favours encode speed for model copies: exact lossless pixels instead of near-lossless", async () => {
    // Agents make a copy per screenshot, so model copies use lossless WebP at the lowest
    // effort (about 0.1 s for a full-size screenshot instead of 1-1.5 s for near-lossless).
    const inputPath = join(tempDir, "ui.png");
    const png = await makeScreenshotLikePng(900, 700);
    await writeFile(inputPath, png);

    const result = await optimizeAgentImageFile(inputPath);
    const output = await readFile(result.outputPath);

    expect(result.outputPath.endsWith("ui.takode-agent.webp")).toBe(true);
    expect(output.length).toBeLessThan(png.length);
    expect(await meanPixelDifference(png, output)).toBe(0);
    // The shared default favours size and is not pixel-exact.
    const sizeFirst = await optimizeImageBufferForStore(png, "image/png");
    expect(await meanPixelDifference(png, sizeFirst.data)).toBeGreaterThan(0);
  });

  it("no-ops on already marked optimized paths", async () => {
    const inputPath = join(tempDir, "screenshot.takode-agent.jpeg");
    const jpeg = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    await writeFile(inputPath, jpeg);

    const result = await optimizeAgentImageFile(inputPath);

    expect(isTakodeAgentOptimizedPath(inputPath)).toBe(true);
    expect(result.outputPath).toBe(inputPath);
    expect(result.alreadyOptimized).toBe(true);
    expect(result.wroteOutput).toBe(false);
  });
});
