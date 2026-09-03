import { afterEach, describe, expect, it, vi } from "vitest";
import { printCommandHelp, printUsage } from "./takode-help.js";

describe("takode help", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the retired thread-response command from public help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    printUsage();

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).not.toContain("thread-response");
    expect(output).toContain("user-message  Deprecated compatibility publisher");
    expect(printCommandHelp("thread-response", [])).toBe(false);
  });

  it("points deprecated user-message callers to role-bearing routed text", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(printCommandHelp("user-message", [])).toBe(true);

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("[thread:main:C] / [thread:q-N:C] for commentary");
    expect(output).toContain("[thread:main:F] / [thread:q-N:F] for final responses");
  });
});
