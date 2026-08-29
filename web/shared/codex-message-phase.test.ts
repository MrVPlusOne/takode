import { describe, expect, it } from "vitest";
import { normalizeCodexMessagePhase } from "./codex-message-phase.js";

describe("normalizeCodexMessagePhase", () => {
  it("accepts only official commentary and final-answer classifications", () => {
    expect(normalizeCodexMessagePhase("commentary")).toBe("commentary");
    expect(normalizeCodexMessagePhase("final_answer")).toBe("final_answer");
    expect(normalizeCodexMessagePhase(null)).toBeUndefined();
    expect(normalizeCodexMessagePhase("user")).toBeUndefined();
    expect(normalizeCodexMessagePhase({ recipient: "user" })).toBeUndefined();
  });
});
