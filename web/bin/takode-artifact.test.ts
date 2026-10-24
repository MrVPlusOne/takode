import { describe, expect, it } from "vitest";
import type { ArtifactSummary } from "../shared/artifact-library.js";
import { formatArtifactList } from "./takode-artifact.js";

/**
 * `takode artifact list` stays compact: one row per artifact with a short ID the agent can pass to
 * `show`, the kind, version count and title, never the full UUID or the content.
 */
describe("takode artifact list", () => {
  it("prints short IDs and no content", () => {
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
      "  0f1e2d3c  Post v3  T7 thread update ★  · q-2713 · 0s ago",
      "… 1 more (--limit)",
    ]);
  });
});
