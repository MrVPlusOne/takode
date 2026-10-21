import { describe, expect, it } from "vitest";
import { mergeVoiceText, readVoiceResultTarget, type VoiceResultTarget } from "./voice-results.js";

const composer = (baseText: string, selectionStart: number, selectionEnd = selectionStart): VoiceResultTarget => ({
  kind: "composer",
  baseText,
  selectionStart,
  selectionEnd,
});
const answer = (baseText: string, selectionStart: number, selectionEnd = selectionStart): VoiceResultTarget => ({
  kind: "needs-input",
  notificationId: "n-1",
  questionKey: "q",
  baseText,
  selectionStart,
  selectionEnd,
});

describe("mergeVoiceText", () => {
  it("inserts at the recorded cursor while the draft is unchanged", () => {
    expect(mergeVoiceText("Fix the bug", composer("Fix the bug", 3), "quickly")).toBe("Fix quickly the bug");
    // Dictation into an empty composer replaces its whitespace, as before.
    expect(mergeVoiceText("  ", composer("  ", 0, 2), "Hello")).toBe("Hello");
  });

  it("keeps text typed meanwhile and adds the transcript at the end", () => {
    expect(mergeVoiceText("Fix the bug now", composer("Fix the bug", 3), "quickly")).toBe("Fix the bug now quickly");
  });

  it("inserts answers without a separating space, replacing the recorded selection", () => {
    expect(mergeVoiceText("ship now", answer("ship now", 0), "please ")).toBe("please ship now");
    expect(mergeVoiceText("ship later", answer("ship later", 5, 10), "now")).toBe("ship now");
    expect(mergeVoiceText("changed", answer("stale", 5), " later")).toBe("changed later");
  });
});

describe("readVoiceResultTarget", () => {
  it("accepts composer and answer targets, from JSON or objects", () => {
    expect(readVoiceResultTarget(JSON.stringify(composer("abc", 1, 2)))).toEqual(composer("abc", 1, 2));
    expect(readVoiceResultTarget(answer("x", 1))).toEqual(answer("x", 1));
    expect(readVoiceResultTarget(undefined)).toBeUndefined();
  });

  it("rejects selections outside the text and unknown kinds", () => {
    expect(() => readVoiceResultTarget(composer("abc", 2, 1))).toThrow();
    expect(() => readVoiceResultTarget(composer("abc", 0, 4))).toThrow();
    expect(() => readVoiceResultTarget({ ...composer("abc", 0), kind: "comment" })).toThrow();
    expect(() => readVoiceResultTarget({ ...answer("abc", 0), notificationId: "" })).toThrow();
  });
});
