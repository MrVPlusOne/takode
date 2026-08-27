import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("published package contents", () => {
  it("includes shared runtime modules imported by server and CLI entrypoints", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8")) as {
      files?: string[];
    };

    expect(packageJson.files).toEqual(expect.arrayContaining(["bin/", "server/", "shared/"]));
  });
});
