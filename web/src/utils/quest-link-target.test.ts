import { isReservedQuestLinkHref, parseQuestLinkTarget } from "./quest-link-target.js";

describe("parseQuestLinkTarget", () => {
  it.each([
    ["q-42", { questId: "q-42" }],
    ["quest:q-42", { questId: "q-42" }],
    ["quest://q-42", { questId: "q-42" }],
    [" QUEST:Q-42:FEEDBACK:5 ", { questId: "q-42", feedbackIndex: 5 }],
    ["quest:q-42#feedback-5", { questId: "q-42", feedbackIndex: 5 }],
  ])("parses %s", (href, expected) => {
    expect(parseQuestLinkTarget(href)).toEqual(expected);
  });

  it.each([
    "quest:q-42:feedback:-1",
    "quest:q-42:feedback:1.5",
    "quest:q-42:feedback:",
    "quest:q-42#feedback-nope",
    "quest:q-42#feedback-3-extra",
    "quest://q-42:feedback:3",
    `quest:q-42:feedback:${Number.MAX_SAFE_INTEGER}0`,
  ])("rejects malformed or unsupported target %s", (href) => {
    expect(parseQuestLinkTarget(href)).toBeNull();
  });
});

describe("isReservedQuestLinkHref", () => {
  it("identifies malformed quest-scheme links without claiming unrelated custom schemes", () => {
    expect(isReservedQuestLinkHref("quest:q-42:feedback:nope")).toBe(true);
    expect(isReservedQuestLinkHref("custom:q-42:feedback:5")).toBe(false);
  });
});
