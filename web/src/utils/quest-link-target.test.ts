import { isReservedQuestLinkHref, parseQuestLinkTarget } from "./quest-link-target.js";
import { deliveryCommitHref } from "../../shared/quest-delivery.js";

describe("parseQuestLinkTarget", () => {
  it("preserves both full range endpoints and selected commit without changing ordinary fixed links", () => {
    // All identities must survive authoring/parsing; short or mutable endpoints are not native range links.
    const id = "a".repeat(32);
    const sha = "b".repeat(40);
    const range = { baseSha: "c".repeat(40), tipSha: "d".repeat(40) };
    expect(parseQuestLinkTarget(deliveryCommitHref("q-42", id, sha, range))).toEqual({
      questId: "q-42",
      delivery: { id, sha, range },
    });
    expect(parseQuestLinkTarget(deliveryCommitHref("q-42", id, sha))).toEqual({
      questId: "q-42",
      delivery: { id, sha },
    });
    expect(parseQuestLinkTarget(deliveryCommitHref("q-42", id, sha, { ...range, baseSha: "main" }))).toBeNull();
  });
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
