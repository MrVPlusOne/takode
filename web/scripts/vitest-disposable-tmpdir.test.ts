import { tmpdir } from "node:os";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { DISPOSABLE_TMPDIR_PREFIX } from "./vitest-disposable-tmpdir.js";

describe("vitest disposable tmpdir", () => {
  it("runs tests with TMPDIR set to a per-run directory", () => {
    // The global setup must reach worker processes; otherwise the temp
    // directories tests leave behind accumulate in the machine's /tmp and slow
    // down every Bun process started below it.
    expect(process.env.TMPDIR).toBe(tmpdir());
    expect(basename(tmpdir()).startsWith(DISPOSABLE_TMPDIR_PREFIX)).toBe(true);
  });
});
