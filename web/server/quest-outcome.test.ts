import { describe, expect, it } from "vitest";
import type { QuestInProgress, QuestOutcomeMessageSource } from "./quest-types.js";
import {
  QuestOutcomeConflictError,
  QuestOutcomeIdempotencyConflictError,
  appendQuestOutcomeRevision,
  currentQuestOutcomeRevision,
  deriveQuestOutcomeSummary,
  finalizeQuestOutcome,
  hasSubstantiveQuestOutcome,
  normalizeQuestOutcomeMarkdown,
  reopenQuestOutcome,
} from "./quest-outcome.js";

function quest(): QuestInProgress {
  return {
    id: "q-1",
    questId: "q-1",
    version: 2,
    title: "Test outcome",
    description: "Test",
    status: "in_progress",
    sessionId: "worker-1",
    claimedAt: 1,
    createdAt: 1,
  };
}

function messageSource(messageId = "a1"): QuestOutcomeMessageSource {
  return {
    kind: "message",
    sessionId: "leader-1",
    messageId,
    historyIndex: 4,
    targetQuestId: "q-1",
    sourceThreadKeys: ["q-1"],
    contentHash: "source-hash",
  };
}

describe("Quest Outcome content", () => {
  it("removes structural feed directives outside fences but preserves literal examples", () => {
    const markdown = normalizeQuestOutcomeMarkdown(
      [
        "[thread:q-1]",
        "Delivered the useful result.",
        "{[(Quest Quiz: q-1)]}",
        "{[(Thread Ready: q-1 | complete)]}",
        "```text",
        "{[(Quest Quiz: q-1)]}",
        "```",
      ].join("\n"),
    );

    expect(markdown).toBe("Delivered the useful result.\n```text\n{[(Quest Quiz: q-1)]}\n```");
    expect(hasSubstantiveQuestOutcome("{[(Quest Quiz: q-1)]}")).toBe(false);
    expect(hasSubstantiveQuestOutcome("| Result | State |\n| --- | --- |\n| Build | Green |")).toBe(true);
  });

  it("derives a compact summary from complete opening Markdown blocks and uses the full short document", () => {
    expect(deriveQuestOutcomeSummary("## Result\n\nEverything shipped cleanly.")).toBe(
      "## Result\n\nEverything shipped cleanly.",
    );
    const firstParagraph = "A".repeat(260);
    const firstList = "- First complete point\n- Second complete point";
    const later = "Later detail ".repeat(80);
    const summary = deriveQuestOutcomeSummary(`${firstParagraph}\n\n${firstList}\n\n${later}`);
    expect(summary).toBe(`${firstParagraph}\n\n${firstList}`);
    expect(summary).not.toContain("Later detail");
  });

  it("keeps the first narrative block when an opening heading plus that block exceeds the target", () => {
    const narrative =
      "This deliberately long opening narrative carries the actual outcome rather than merely naming its section. ".repeat(
        8,
      );
    const summary = deriveQuestOutcomeSummary(`## Result\n\n${narrative}\n\nLater implementation detail.`);

    expect(summary).toBe(`## Result\n\n${narrative.trimEnd()}`);
    expect(summary).not.toContain("Later implementation detail");
  });
});

describe("Quest Outcome revisions", () => {
  it("appends immutable CAS revisions with optional authored summary and exact anchors", () => {
    const first = appendQuestOutcomeRevision(
      quest(),
      {
        baseRevisionId: null,
        markdown: "## Result\n\nFirst outcome.",
        actor: { kind: "leader", sessionId: "leader-1" },
        anchor: { sessionId: "leader-1", historyIndex: 4, messageId: "a1" },
        sources: [messageSource()],
        idempotencyKey: "operation-1",
      },
      { now: 10, revisionId: "r1" },
    );
    const second = appendQuestOutcomeRevision(
      first,
      {
        baseRevisionId: "r1",
        markdown: "## Result\n\nRefined outcome.",
        summaryMarkdown: "Refined result.",
        actor: { kind: "human" },
        anchor: { sessionId: "leader-1", historyIndex: 8, messageId: "a2" },
        sources: [messageSource("a2")],
      },
      { now: 20, revisionId: "r2" },
    );

    expect(first.outcome?.revisions).toHaveLength(1);
    expect(second.outcome?.revisions).toHaveLength(2);
    expect(currentQuestOutcomeRevision(second.outcome)).toMatchObject({
      revisionId: "r2",
      parentRevisionId: "r1",
      summaryMarkdown: "Refined result.",
      summarySource: "authored",
      anchor: { sessionId: "leader-1", historyIndex: 8, messageId: "a2" },
    });
    expect(currentQuestOutcomeRevision(first.outcome)?.markdown).toBe("## Result\n\nFirst outcome.");
  });

  it("rejects stale writes while exact idempotent retries remain no-ops", () => {
    const first = appendQuestOutcomeRevision(
      quest(),
      {
        baseRevisionId: null,
        markdown: "First outcome.",
        actor: { kind: "human" },
        sources: [{ kind: "manual", targetQuestId: "q-1", contentHash: "hash" }],
        idempotencyKey: "operation-1",
      },
      { now: 10, revisionId: "r1" },
    );
    expect(
      appendQuestOutcomeRevision(first, {
        baseRevisionId: null,
        markdown: "First outcome.",
        actor: { kind: "human" },
        sources: [{ kind: "manual", targetQuestId: "q-1", contentHash: "hash" }],
        idempotencyKey: "operation-1",
      }),
    ).toBe(first);
    expect(() =>
      appendQuestOutcomeRevision(first, {
        baseRevisionId: null,
        markdown: "Stale overwrite.",
        actor: { kind: "human" },
        sources: [{ kind: "manual", targetQuestId: "q-1", contentHash: "hash-2" }],
      }),
    ).toThrow(QuestOutcomeConflictError);
    expect(() =>
      appendQuestOutcomeRevision(first, {
        baseRevisionId: null,
        markdown: "Different payload with a reused operation key.",
        actor: { kind: "human" },
        sources: [{ kind: "manual", targetQuestId: "q-1", contentHash: "hash-3" }],
        idempotencyKey: "operation-1",
      }),
    ).toThrow(QuestOutcomeIdempotencyConflictError);
  });

  it("seals a new revision when a completed Outcome is edited", () => {
    const completed = {
      ...quest(),
      status: "done" as const,
      completedAt: 20,
      verificationItems: [],
      sessionId: undefined,
      claimedAt: undefined,
    };
    const updated = appendQuestOutcomeRevision(
      completed,
      {
        baseRevisionId: null,
        markdown: "Corrected completed result.",
        actor: { kind: "human" },
        sources: [{ kind: "manual", targetQuestId: "q-1", contentHash: "corrected" }],
      },
      { now: 30, revisionId: "r1" },
    );
    expect(updated.outcome).toMatchObject({
      currentRevisionId: "r1",
      finalizedRevisionId: "r1",
      finalizedAt: 30,
    });
    expect(updated).toMatchObject({
      debrief: "Corrected completed result.",
      debriefTldr: "Corrected completed result.",
    });
  });

  it("marks a previous final revision when a completed quest reopens", () => {
    const first = appendQuestOutcomeRevision(
      quest(),
      {
        baseRevisionId: null,
        markdown: "Delivered result.",
        actor: { kind: "human" },
        sources: [{ kind: "manual", targetQuestId: "q-1", contentHash: "hash" }],
      },
      { now: 10, revisionId: "r1" },
    );
    const finalized = finalizeQuestOutcome(first.outcome, 20);
    expect(reopenQuestOutcome(finalized, 30)).toMatchObject({
      currentRevisionId: "r1",
      previousFinalRevisionId: "r1",
      reopenedAt: 30,
    });
  });
});
