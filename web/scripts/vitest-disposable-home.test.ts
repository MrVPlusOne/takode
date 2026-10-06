import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { DISPOSABLE_HOME_PREFIX } from "./vitest-disposable-home.js";

describe("vitest disposable home", () => {
  it("runs tests with HOME set to a fresh temporary directory", () => {
    // The global setup must take effect in worker processes, otherwise tests
    // that default to ~/.companion write into the developer's real data.
    const home = homedir();
    expect(process.env.HOME).toBe(home);
    expect(dirname(home)).toBe(realpathSync(tmpdir()));
    expect(basename(home).startsWith(DISPOSABLE_HOME_PREFIX)).toBe(true);
  });
});
