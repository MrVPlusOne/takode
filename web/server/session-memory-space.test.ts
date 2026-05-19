import { describe, expect, it } from "vitest";
import {
  memorySessionSpaceSlugForTreeGroup,
  memorySessionSpaceSlugsForTreeGroups,
  planSessionMemorySpaceBackfill,
} from "./session-memory-space.js";

const treeState = {
  groups: [
    { id: "default", name: "Default" },
    { id: "msi", name: "MSI" },
  ],
};

describe("session-memory-space", () => {
  it("derives default memory slugs from tree group names with default fallback", () => {
    expect(memorySessionSpaceSlugForTreeGroup(treeState, "msi", "Takode")).toBe("MSI");
    expect(memorySessionSpaceSlugForTreeGroup(treeState, "default", "Takode")).toBe("Takode");
    expect(memorySessionSpaceSlugForTreeGroup(treeState, undefined, "Takode")).toBe("Takode");
    expect(memorySessionSpaceSlugsForTreeGroups(treeState, "Takode")).toEqual(["Takode", "MSI"]);
  });

  it("plans non-destructive backfill for restored sessions missing memory space metadata", () => {
    const updates = planSessionMemorySpaceBackfill(
      [
        { sessionId: "dreamer", treeGroupId: "msi" },
        { sessionId: "stale-default", treeGroupId: "msi", memorySessionSpaceSlug: "Takode" },
        { sessionId: "already-fixed", treeGroupId: "msi", memorySessionSpaceSlug: "MSI" },
        { sessionId: "explicit-cross-space", treeGroupId: "msi", memorySessionSpaceSlug: "Research" },
        { sessionId: "takode-default", treeGroupId: "default" },
      ],
      treeState,
      "Takode",
    );

    expect(updates).toEqual([
      { sessionId: "dreamer", treeGroupId: "msi", memorySessionSpaceSlug: "MSI" },
      { sessionId: "stale-default", treeGroupId: "msi", memorySessionSpaceSlug: "MSI" },
    ]);
  });
});
