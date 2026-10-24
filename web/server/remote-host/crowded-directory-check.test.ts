import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCrowdedDirectories } from "./crowded-directory-check.js";

// A fixture machine: a Takode checkout, a temporary folder and a worktree folder
// under one root, with small limits so a few files count as crowded.
describe("findCrowdedDirectories", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "takode-crowded-dirs-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function fill(dir: string, count: number) {
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < count; i++) await writeFile(join(dir, `f${i}`), "");
  }

  it("names each crowded folder once with everything it slows, and stops counting at the limit", async () => {
    // `shared` sits above the checkout, the temp folder and the worktrees, so it slows all three.
    const shared = join(root, "shared");
    await fill(shared, 6);
    await mkdir(join(shared, "takode", "web"), { recursive: true });
    await fill(join(shared, "tmp"), 12);
    await fill(join(shared, "worktrees", "repo"), 7);
    await fill(join(shared, "worktrees", "small"), 2);

    const crowded = await findCrowdedDirectories(
      {
        takodeRoot: join(shared, "takode", "web"),
        tempDir: join(shared, "tmp"),
        worktreesDir: join(shared, "worktrees"),
      },
      5,
      10,
    );

    // The fixture's own parents (the test temp folder, /) may count as crowded at this tiny threshold.
    const byPath = Object.fromEntries(
      crowded.filter((directory) => directory.path.startsWith(shared)).map((directory) => [directory.path, directory]),
    );
    expect(Object.keys(byPath).sort()).toEqual([shared, join(shared, "tmp"), join(shared, "worktrees", "repo")].sort());
    // 6 files plus the takode, tmp and worktrees folders.
    expect(byPath[shared]).toMatchObject({ entries: 9, more: false, affects: ["takode", "temp", "worktrees"] });
    expect(byPath[join(shared, "tmp")]).toMatchObject({ entries: 10, more: true, affects: ["temp"] });
    expect(byPath[join(shared, "worktrees", "repo")]).toMatchObject({ entries: 7, affects: ["worktrees"] });
  });

  it("skips folders that do not exist", async () => {
    const missing = join(root, "missing");
    expect(
      await findCrowdedDirectories({ takodeRoot: missing, tempDir: missing, worktreesDir: missing }, 1, 10),
    ).toEqual(expect.not.arrayContaining([expect.objectContaining({ path: missing })]));
  });
});
