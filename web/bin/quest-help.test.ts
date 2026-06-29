import { afterEach, describe, expect, it, vi } from "vitest";
import { showHelp } from "./quest-help.js";

describe("quest help", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("documents quest show progressive reveal before full detail", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    showHelp();

    const output = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "show   <id> [--sections <list>] [--full] [--json]       Show compact quest detail; reveal sections on demand",
    );
    expect(output).toContain("quest show q-1 --sections description,debrief");
    expect(output).toContain("quest show q-1 --sections phases");
    expect(output).toContain("quest show q-1 --sections phase:7");
    expect(output).toContain("Expensive full detail; prefer --sections first");
  });
});
