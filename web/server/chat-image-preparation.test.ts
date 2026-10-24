import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RouteContext } from "./routes/context.js";

// The real store and thumbnails write under the home directory; these stand-ins record the work.
const fakes = vi.hoisted(() => ({
  prepare: vi.fn(async (_path: string, _mimeType: string) => {}),
  thumbnail: vi.fn(async (_id: string, _theme: string) => null),
}));
vi.mock("./local-image-variant-store.js", () => ({
  sharedLocalImageVariantStore: () => ({ prepare: fakes.prepare }),
}));
vi.mock("./artifact-thumbnails.js", () => ({
  getArtifactThumbnails: () => ({ get: fakes.thumbnail }),
}));

import { prepareChatImages, prepareLibraryThumbnail } from "./chat-image-preparation.js";
import { imageConversionQueue } from "./image-conversion-queue.js";
import { findLocalImageReferences } from "../shared/local-image-references.js";

/**
 * Preparing the images an agent showed: each mention is turned into the same local file the
 * feed's preview request would read (a relative link through the session's folder, a plain path
 * as is), missing files are skipped, and figures get their gallery thumbnail.
 */

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "chat-image-preparation-"));
  fakes.prepare.mockClear();
  fakes.thumbnail.mockClear();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function bridgeWithCwd(cwd: string): RouteContext["wsBridge"] {
  return { getSession: () => ({ state: { cwd } }) } as unknown as RouteContext["wsBridge"];
}

describe("prepareChatImages", () => {
  it("prepares linked and pasted images from the files the feed reads, skipping missing ones", async () => {
    await mkdir(join(workDir, "docs"));
    await writeFile(join(workDir, "docs", "shot.png"), "png");
    await writeFile(join(workDir, "plain.jpg"), "jpg");
    const text = [
      "[the shot](file:docs/shot.png)",
      `and ${join(workDir, "plain.jpg")}`,
      `but not ${join(workDir, "gone.png")}`,
    ].join("\n");

    prepareChatImages("s1", findLocalImageReferences(text), bridgeWithCwd(workDir));
    await imageConversionQueue.idle();

    expect(fakes.prepare.mock.calls).toEqual([
      [join(workDir, "docs", "shot.png"), "image/png"],
      [join(workDir, "plain.jpg"), "image/jpeg"],
    ]);
  });

  it("queues a saved figure's gallery thumbnail", async () => {
    prepareLibraryThumbnail("figure-1");
    await imageConversionQueue.idle();

    expect(fakes.thumbnail).toHaveBeenCalledWith("figure-1", "dark");
  });
});
