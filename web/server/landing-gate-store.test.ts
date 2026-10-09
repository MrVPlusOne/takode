import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LandingGateStore } from "./landing-gate-store.js";

const gate = (name: string) => ({ version: 1 as const, steps: [{ name, run: ["true"] }] });

/** Saved landing gates in a disposable directory, as the server keeps them per repository branch. */
describe("landing gate store", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "landing-gates-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("saves, replaces, lists and removes gates per repository branch, and persists them", async () => {
    const store = new LandingGateStore("server", directory);
    expect(await store.get({ repo: "takode", branch: "jiayi" })).toBeNull();
    const first = await store.set(
      { repo: "Takode", branch: "jiayi" },
      gate("check"),
      { sessionId: "s1", sessionNum: 7 },
      1,
    );
    expect(first.previous).toBeNull();
    expect(first.gate).toMatchObject({
      key: "takode:jiayi",
      target: { repo: "takode", branch: "jiayi" },
      updatedBySessionNum: 7,
    });
    await store.set({ repo: "other", branch: "main" }, gate("lint"), {}, 2);
    const replaced = await store.set({ repo: "takode", branch: "jiayi" }, gate("tests"), { sessionId: "s2" }, 3);
    expect(replaced.previous?.config.steps[0]!.name).toBe("check");

    // A fresh store (a restarted server) reads the same gates from disk.
    const reloaded = new LandingGateStore("server", directory);
    expect((await reloaded.list()).map((item) => [item.key, item.config.steps[0]!.name])).toEqual([
      ["other:main", "lint"],
      ["takode:jiayi", "tests"],
    ]);
    expect((await reloaded.remove({ repo: "takode", branch: "jiayi" }))?.config.steps[0]!.name).toBe("tests");
    expect(await reloaded.remove({ repo: "takode", branch: "jiayi" })).toBeNull();
    const file = JSON.parse(await readFile(join(directory, "server.json"), "utf-8"));
    expect(file.gates.map((item: { key: string }) => item.key)).toEqual(["other:main"]);
  });

  it("refuses to treat an unreadable gates file as having no gates", async () => {
    // Treating a corrupt file as empty would look like every branch opted out, and the next save
    // would overwrite the saved gates.
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "server.json"), "{ not json");
    const store = new LandingGateStore("server", directory);
    await expect(store.get({ repo: "takode", branch: "jiayi" })).rejects.toThrow("Cannot read the saved landing gates");
    await expect(store.set({ repo: "takode", branch: "jiayi" }, gate("check"), {})).rejects.toThrow();
    expect(await readFile(join(directory, "server.json"), "utf-8")).toBe("{ not json");
  });
});
