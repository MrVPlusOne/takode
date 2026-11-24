import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { claudeReadImageHook, shrinkReadImageOutput } from "./claude-read-image-hook.js";
import { makeScreenshotLikePng } from "./test-fixtures/images.js";

/** Read's output for an image, in the shape Claude Code 2.1.311 passes to PostToolUse hooks. */
function readOutput(data: Buffer, type: string, width: number, height: number) {
  return {
    type: "image",
    file: {
      base64: data.toString("base64"),
      type,
      originalSize: data.length,
      dimensions: { originalWidth: width, originalHeight: height, displayWidth: width, displayHeight: height },
    },
  };
}

describe("shrinkReadImageOutput", () => {
  it("re-encodes a large PNG render as WebP at the same pixels", async () => {
    // Renders an agent reads stay in every later request; their PNG bytes are
    // what made Copilot time out reading the request body.
    const png = await makeScreenshotLikePng(1440, 1200);
    const output = readOutput(png, "image/png", 1440, 1200);

    const shrunk = await shrinkReadImageOutput(output);

    expect(shrunk?.file.type).toBe("image/webp");
    expect(shrunk!.file.base64.length).toBeLessThan(output.file.base64.length / 2);
    const meta = await sharp(Buffer.from(shrunk!.file.base64, "base64")).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 1440, 1200]);
    // Everything else Read reported stays, so Claude Code builds the same tool result.
    expect(shrunk!.file.originalSize).toBe(png.length);
    expect(shrunk!.file.dimensions).toEqual(output.file.dimensions);
  });

  it("leaves small images, other formats and non-image output alone", async () => {
    const small = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } })
      .png()
      .toBuffer();
    expect(await shrinkReadImageOutput(readOutput(small, "image/png", 64, 64))).toBeNull();

    const large = await makeScreenshotLikePng(1440, 1200);
    expect(await shrinkReadImageOutput(readOutput(large, "image/webp", 1440, 1200))).toBeNull();
    expect(await shrinkReadImageOutput({ type: "text", file: { content: "hello" } })).toBeNull();
    expect(await shrinkReadImageOutput(undefined)).toBeNull();
  });
});

describe("claudeReadImageHook", () => {
  it("returns the smaller image as Read's updated output", async () => {
    const png = await makeScreenshotLikePng(1440, 1200);
    const hook = claudeReadImageHook.hooks[0]!;

    const answer = (await hook(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/work/out/render.png" },
        tool_response: readOutput(png, "image/png", 1440, 1200),
      } as any,
      "toolu_1",
      { signal: new AbortController().signal },
    )) as any;

    expect(claudeReadImageHook.matcher).toBe("Read");
    expect(answer.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(answer.hookSpecificOutput.updatedToolOutput.file.type).toBe("image/webp");
  });
});
