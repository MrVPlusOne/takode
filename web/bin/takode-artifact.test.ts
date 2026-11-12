import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { ArtifactSummary } from "../shared/artifact-library.js";
import { formatArtifactList, slidePictures } from "./takode-artifact.js";

/**
 * `takode artifact list` stays compact: one row per artifact with the kind, version count and a
 * ready-to-paste artifact link whose short ID the agent can also pass to `show`, never the full
 * UUID or the content.
 */
describe("takode artifact list", () => {
  it("prints ready-to-paste links with short IDs and no content", () => {
    const now = Date.now();
    const artifact: ArtifactSummary = {
      id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
      kind: "post",
      title: "T7 thread update",
      space: "MSI",
      sessionId: "s1",
      threadKey: "q-2713",
      createdAt: now,
      updatedAt: now,
      starred: true,
      versionCount: 3,
      latest: {
        n: 3,
        at: now,
        bytes: 9,
        kept: true,
        source: {
          sessionId: "s1",
          messageId: "m",
          threadKey: "q-2713",
          at: now,
        },
      },
      preview: "Quick T7 update with a long body that must not appear",
    };
    const text = formatArtifactList({
      artifacts: [artifact],
      total: 2,
      spaces: ["MSI"],
      space: "MSI",
    });
    expect(text.split("\n")).toEqual([
      "2 artifacts (space MSI), newest first:",
      "  Post v3  [T7 thread update](artifact:0f1e2d3c) ★  · q-2713 · 0s ago",
      "… 1 more (--limit)",
    ]);
  });
});

/**
 * `takode artifact publish --previews <dir>` sends a folder's slide pictures in slide order, as
 * LibreOffice names them (slide1.png ... slide10.png, which sort wrongly as text), skipping other files.
 */
describe("takode artifact publish", () => {
  it("orders slide pictures by their number and leaves other files out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slide-pictures-"));
    try {
      for (const name of ["slide10.png", "slide2.png", "slide1.PNG", "deck.pdf", "notes.txt"]) {
        await writeFile(join(dir, name), "x");
      }
      expect((await slidePictures(dir)).map((path) => basename(path))).toEqual([
        "slide1.PNG",
        "slide2.png",
        "slide10.png",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
