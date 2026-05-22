import { describe, expect, it, vi } from "vitest";
import { CooperativeTiming } from "./cooperative-timing.js";

describe("CooperativeTiming", () => {
  it("logs slow steps and one summary with step details", async () => {
    let now = 0;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const timing = new CooperativeTiming({
      label: "test launch prep",
      logger,
      now: () => now,
      stepWarnThresholdMs: 20,
      summaryThresholdMs: 1000,
      yieldEveryMs: 1000,
    });

    const result = await timing.step("copy fresh home", () => {
      now += 25;
      return "done";
    });
    timing.finish({ container: false });

    expect(result).toBe("done");
    expect(logger.warn).toHaveBeenCalledWith("[timing] test launch prep: slow step copy fresh home 25ms");
    expect(logger.info).toHaveBeenCalledWith(
      "[timing] test launch prep: total=25ms | copy fresh home=25ms | container=false",
    );
  });

  it("cooperatively yields only after the configured interval has elapsed", async () => {
    let now = 0;
    const yieldFn = vi.fn(async () => {
      now += 2;
    });
    const timing = new CooperativeTiming({
      label: "test launch prep",
      logger: { info: vi.fn(), warn: vi.fn() },
      now: () => now,
      yieldFn,
      yieldEveryMs: 10,
    });

    expect(await timing.yieldIfDue("too soon")).toBe(false);
    now = 10;
    expect(await timing.yieldIfDue("fresh home copy")).toBe(true);

    expect(yieldFn).toHaveBeenCalledTimes(1);
    expect(timing.recordedYieldCountForTest).toBe(1);
  });

  it("records synchronous steps without forcing an async yield boundary", () => {
    let now = 0;
    const logger = { info: vi.fn(), warn: vi.fn() };
    const timing = new CooperativeTiming({
      label: "test launch prep",
      logger,
      now: () => now,
      stepWarnThresholdMs: 20,
    });

    const result = timing.stepSync("resolve binary", () => {
      now += 21;
      return "/opt/bin/codex";
    });
    timing.finish();

    expect(result).toBe("/opt/bin/codex");
    expect(logger.warn).toHaveBeenCalledWith("[timing] test launch prep: slow step resolve binary 21ms");
    expect(logger.info).toHaveBeenCalledWith("[timing] test launch prep: total=21ms | resolve binary=21ms");
  });
});
