import { describe, expect, it } from "vitest";
import { buildComposerPlaceholder } from "./composer-placeholder.js";

/**
 * In a topic conversation, messages go to the topic (the leader files them under a quest), so the
 * composer names the topic on every screen; quest tabs keep naming their quest on wide screens.
 */
describe("buildComposerPlaceholder", () => {
  const base = {
    isCodex: false,
    isLeaderSession: true,
    threadKey: "main",
    usesTouchKeyboard: false,
    isNarrowLayout: false,
    pendingAskUserPerm: null,
    pendingPlanPerm: null,
  };

  it("names the topic in a topic conversation, also on phones", () => {
    expect(buildComposerPlaceholder({ ...base, topicName: "Daily briefing" })).toMatch(
      /^Posting to Daily briefing \.\.\./,
    );
    expect(
      buildComposerPlaceholder({ ...base, topicName: "Daily briefing", usesTouchKeyboard: true, isNarrowLayout: true }),
    ).toMatch(/^Posting to Daily briefing \.\.\./);
  });

  it("doesn't double the ellipsis of a thread still named after its first words", () => {
    expect(buildComposerPlaceholder({ ...base, topicName: "Quick question: how do…" })).toMatch(
      /^Posting to Quick question: how do \.\.\. /,
    );
  });

  it("keeps naming the quest in a quest tab and nothing in Main", () => {
    expect(buildComposerPlaceholder({ ...base, threadKey: "q-12" })).toMatch(/^Posting to q-12 \.\.\./);
    expect(buildComposerPlaceholder(base)).toMatch(/^Type a message\.\.\./);
  });
});
