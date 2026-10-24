import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageConversionQueue } from "./image-conversion-queue.js";

/**
 * Background image conversions run one at a time, in the order they were queued, and one
 * failing conversion is logged without stopping the ones after it.
 */
describe("ImageConversionQueue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs conversions one at a time, in order, past a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = new ImageConversionQueue();
    const events: string[] = [];
    let running = 0;
    const job =
      (name: string, fail = false) =>
      async () => {
        running += 1;
        // Never more than one at a time, even when a job yields to the event loop.
        expect(running).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(name);
        running -= 1;
        if (fail) throw new Error("broken image");
      };

    queue.add("first", job("first"));
    queue.add("second", job("second", true));
    queue.add("third", job("third"));
    await queue.idle();

    expect(events).toEqual(["first", "second", "third"]);
    expect(warn).toHaveBeenCalledWith("[image-conversions] second failed:", expect.any(Error));
  });
});
