import { afterEach, describe, expect, it, vi } from "vitest";
import { printCommandHelp, printUsage } from "./takode-help.js";

describe("takode help", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits superseded leader authoring commands from public help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    printUsage();

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).not.toContain("thread-response");
    expect(output).not.toContain("user-message");
    expect(printCommandHelp("thread-response", [])).toBe(false);
    expect(printCommandHelp("user-message", [])).toBe(false);
  });

  it("documents session-scoped human-message retrieval on the existing read command", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(printCommandHelp("read", [])).toBe(true);

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("takode read <session> <history-index|uN>");
    expect(output).not.toContain("timer-m");
    expect(output).not.toContain("fN");
  });
});
