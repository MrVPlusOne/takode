import { resolveSessionSpaceForCreate } from "./session-create-space.js";

// Mirrors a real server: Default uses the server memory space "Takode", and a
// named "Takode" session space uses the same memory space.
const treeState = {
  groups: [
    { id: "default", name: "Default" },
    { id: "g-takode", name: "Takode" },
    { id: "g-msi", name: "MSI" },
  ],
};
const base = { treeState, fallbackSlug: "Takode" };

describe("resolveSessionSpaceForCreate", () => {
  it("keeps the creator's session space when it already uses the requested memory space", () => {
    // Herded spawns send both createdBy and the leader's memory space; a leader
    // in Default must keep its workers in Default even though a named space
    // shares the memory space.
    expect(
      resolveSessionSpaceForCreate({ ...base, requestedMemorySlug: "Takode", creatorTreeGroupId: "default" }),
    ).toEqual({ ok: true, treeGroupId: "default", memorySessionSpaceSlug: "Takode", treeGroupFromRequest: false });
  });

  it("moves to the session space of the requested memory space when the creator's disagrees", () => {
    // The group comes from the request, so the post-launch leader grouping must not move it back.
    expect(
      resolveSessionSpaceForCreate({ ...base, requestedMemorySlug: "MSI", creatorTreeGroupId: "default" }),
    ).toEqual({
      ok: true,
      treeGroupId: "g-msi",
      memorySessionSpaceSlug: "MSI",
      treeGroupFromRequest: true,
    });
  });

  it("prefers the named session space over Default for the server's own memory space", () => {
    expect(resolveSessionSpaceForCreate({ ...base, requestedMemorySlug: "Takode" })).toMatchObject({
      ok: true,
      treeGroupId: "g-takode",
    });
  });

  it("derives the memory space from the creator's session space when nothing is requested", () => {
    expect(resolveSessionSpaceForCreate({ ...base, creatorTreeGroupId: "g-msi" })).toEqual({
      ok: true,
      treeGroupId: "g-msi",
      memorySessionSpaceSlug: "MSI",
      treeGroupFromRequest: false,
    });
    expect(resolveSessionSpaceForCreate(base)).toEqual({
      ok: true,
      treeGroupId: undefined,
      memorySessionSpaceSlug: "Takode",
      treeGroupFromRequest: false,
    });
  });

  it("accepts a requested session space with its own memory space and rejects any other", () => {
    expect(
      resolveSessionSpaceForCreate({ ...base, requestedTreeGroupId: "default", requestedMemorySlug: " Takode " }),
    ).toMatchObject({ ok: true, treeGroupId: "default", memorySessionSpaceSlug: "Takode" });
    expect(
      resolveSessionSpaceForCreate({ ...base, requestedTreeGroupId: "g-msi", requestedMemorySlug: "Takode" }),
    ).toMatchObject({ ok: false });
  });
});
