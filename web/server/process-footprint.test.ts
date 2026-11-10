import { readPhysFootprint } from "./process-footprint.js";

describe("readPhysFootprint", () => {
  // Off macOS there is no footprint to read; callers fall back to `ps`.
  it.skipIf(process.platform === "darwin")("reads nothing off macOS", () => {
    expect(readPhysFootprint(process.pid)).toBeNull();
  });

  // The footprint counts memory a process filled, compressed or not: a buffer
  // of one repeated value is what macOS's compressor shrinks the most.
  it.skipIf(process.platform !== "darwin")("counts memory this process fills, and nothing for an ended one", () => {
    const before = readPhysFootprint(process.pid)!;
    const filled = new Float64Array(2 ** 25).fill(7); // 256 MiB
    expect(readPhysFootprint(process.pid)! - before).toBeGreaterThan(200 * 2 ** 20);
    expect(filled[0]).toBe(7);
    // No process has a pid this high, as one that ended has none either.
    expect(readPhysFootprint(2 ** 30)).toBeNull();
  });
});
