import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-cli-image-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("quest optimize-image", () => {
  it("writes an optimized sibling and leaves the original intact", async () => {
    const inputPath = join(tempDir, "capture.png");
    await writeFile(
      inputPath,
      await sharp({
        create: { width: 2200, height: 1200, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 1 } },
      })
        .png()
        .toBuffer(),
    );

    const result = runQuest(["optimize-image", inputPath, "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { outputPath: string; wroteOutput: boolean; convertedToJpeg: boolean };
    expect(payload.outputPath).toBe(join(tempDir, "capture.takode-agent.jpeg"));
    expect(payload.wroteOutput).toBe(true);
    expect(payload.convertedToJpeg).toBe(true);
    expect(existsSync(inputPath)).toBe(true);

    const meta = await sharp(readFileSync(payload.outputPath)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeLessThanOrEqual(1920);
  });

  it("is idempotent for already optimized paths", async () => {
    const inputPath = join(tempDir, "capture.takode-agent.jpeg");
    await writeFile(
      inputPath,
      await sharp({
        create: { width: 400, height: 300, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .jpeg()
        .toBuffer(),
    );

    const result = runQuest(["optimize-image", inputPath, "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      outputPath: string;
      alreadyOptimized: boolean;
      wroteOutput: boolean;
    };
    expect(payload.outputPath).toBe(inputPath);
    expect(payload.alreadyOptimized).toBe(true);
    expect(payload.wroteOutput).toBe(false);
  });
});

function runQuest(args: string[]) {
  const scriptPath = fileURLToPath(new URL("../bin/quest.ts", import.meta.url));
  return spawnSync(process.execPath, [scriptPath, ...args], {
    env: {
      ...process.env,
      HOME: tempDir,
      BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR || join(process.env.HOME || "", ".bun/install/cache"),
    },
    encoding: "utf-8",
  });
}
