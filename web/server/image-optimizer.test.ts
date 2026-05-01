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

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "image-optimizer-test-"));
});

afterEach(() => {
  resetSharpLoaderForTest();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("optimizeImageBufferForStore", () => {
  it("converts eligible PNG buffers to JPEG and reports actual metadata", async () => {
    // Chat and Questmaster uploads share this policy, so PNG screenshots should
    // be converted at ingest instead of remaining larger lossless payloads.
    const png = await sharp({
      create: { width: 900, height: 700, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const result = await optimizeImageBufferForStore(png, "image/png");
    const meta = await sharp(result.data).metadata();

    expect(result.mediaType).toBe("image/jpeg");
    expect(result.convertedToJpeg).toBe(true);
    expect(result.resized).toBe(false);
    expect(meta.format).toBe("jpeg");
  });

  it("uses actual image metadata instead of the declared MIME type", async () => {
    // A screenshot producer can write JPEG bytes to a .png path. The optimizer
    // must inspect bytes and avoid treating extension or declared MIME as truth.
    const jpeg = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 20, g: 120, b: 220 } },
    })
      .jpeg({ quality: 92 })
      .toBuffer();

    const result = await optimizeImageBufferForStore(jpeg, "image/png");

    expect(result.mediaType).toBe("image/jpeg");
    expect(result.convertedToJpeg).toBe(false);
    expect(result.data).toBe(jpeg);
  });
});

describe("optimizeAgentImageFile", () => {
  it("preserves the original and writes a .takode-agent JPEG sibling", async () => {
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
    expect(result.outputPath).toBe(buildTakodeAgentImagePath(inputPath, "image/jpeg"));
    expect(result.wroteOutput).toBe(true);
    expect(result.resized).toBe(true);
    expect(result.convertedToJpeg).toBe(true);
    expect(existsSync(inputPath)).toBe(true);
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeLessThanOrEqual(1920);
    expect(meta.height).toBeLessThanOrEqual(1920);
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
