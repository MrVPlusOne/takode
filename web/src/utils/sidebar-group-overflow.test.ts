import {
  DEFAULT_GROUP_VISIBLE_SESSION_LIMIT,
  normalizeGroupVisibleSessionLimit,
  parseSidebarGroupVisibleLimits,
  serializeSidebarGroupVisibleLimits,
} from "./sidebar-group-overflow.js";

describe("sidebar group overflow preferences", () => {
  it("normalizes invalid and out-of-range visible limits", () => {
    // The menu writes fixed values, but stored localStorage can be stale or hand-edited.
    expect(normalizeGroupVisibleSessionLimit("bad")).toBe(DEFAULT_GROUP_VISIBLE_SESSION_LIMIT);
    expect(normalizeGroupVisibleSessionLimit(0)).toBe(1);
    expect(normalizeGroupVisibleSessionLimit(999)).toBe(200);
  });

  it("round-trips non-default per-group visible limits and omits defaults", () => {
    // Only non-default limits need persistence; default groups fall back to 10 on read.
    const limits = new Map([
      ["default", DEFAULT_GROUP_VISIBLE_SESSION_LIMIT],
      ["team-alpha", 20],
    ]);

    const serialized = serializeSidebarGroupVisibleLimits(limits);

    expect(serialized).toBe('{"team-alpha":20}');
    expect(parseSidebarGroupVisibleLimits(serialized)).toEqual(new Map([["team-alpha", 20]]));
  });

  it("returns an empty map for malformed storage payloads", () => {
    expect(parseSidebarGroupVisibleLimits("{not json")).toEqual(new Map());
    expect(parseSidebarGroupVisibleLimits("[]")).toEqual(new Map());
  });
});
