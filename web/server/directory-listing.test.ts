import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testHome = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => testHome.path,
}));

import { listDirectories } from "./directory-listing.js";

describe("listDirectories places", () => {
  let home: string;

  beforeEach(() => {
    // The listing reads this disposable folder as the machine's home.
    home = mkdtempSync(join(tmpdir(), "directory-listing-home-"));
    testHome.path = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("offers a Mac's iCloud Drive and standard folders that exist, in a fixed order", async () => {
    // iCloud Drive lives at a long path people cannot remember. Downloads is a file here,
    // not a folder, so it is left out rather than offered as a dead end.
    const icloud = join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
    mkdirSync(icloud, { recursive: true });
    mkdirSync(join(home, "Documents"));
    mkdirSync(join(home, "Desktop"));
    writeFileSync(join(home, "Downloads"), "");

    const listing = await listDirectories(undefined, false, "darwin");

    expect(listing.places).toEqual([
      { name: "Home", path: home },
      { name: "iCloud Drive", path: icloud },
      { name: "Desktop", path: join(home, "Desktop") },
      { name: "Documents", path: join(home, "Documents") },
    ]);
    expect(listing.dirs.map((dir) => dir.name)).toEqual(["Desktop", "Documents", "Library"]);
  });

  it("offers no places on other platforms", async () => {
    mkdirSync(join(home, "Documents"));

    expect((await listDirectories(home, false, "linux")).places).toEqual([]);
  });
});
