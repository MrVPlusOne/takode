import { describe, expect, it } from "vitest";
import { classifyBashCommand } from "./context-payload-analysis.js";

describe("classifyBashCommand", () => {
  it("classifies direct Questmaster and Takode commands from executable segments", () => {
    expect(classifyBashCommand("quest show q-1452")).toBe("quest show");
    expect(classifyBashCommand("quest feedback list q-1522 --unaddressed")).toBe("quest feedback");
    expect(classifyBashCommand("takode scan 1286 --context")).toBe("takode scan");
    expect(classifyBashCommand("takode peek 1286 --turn 4 --context")).toBe("takode peek");
  });

  it("does not misclassify quoted search patterns that mention Questmaster commands", () => {
    expect(classifyBashCommand('rg "quest show" web/server')).toBe("search");
    expect(classifyBashCommand('grep -R "quest show" web/server')).toBe("text processing");
  });

  it("does not misclassify file paths that contain quest terms", () => {
    expect(classifyBashCommand('sed -n "1,120p" web/bin/quest.ts')).toBe("text processing");
    expect(classifyBashCommand("ls -l web && wc -l web/bin/quest.ts")).toBe("filesystem inspect");
  });
});
