import { describe, expect, it } from "vitest";
import { makeSharedDraftFixture } from "../shared/test-fixtures/markdown-report.js";
import { readAloudDraftText, readAloudMessageText, readAloudQuestionText } from "./read-aloud-text.js";
import type { ChatMessage } from "./types.js";
import { normalizeHistoryMessageToChatMessages } from "./utils/history-message-normalization.js";

function assistant(content: string): ChatMessage {
  return { id: "m1", role: "assistant", content, timestamp: 1 };
}

describe("readAloudMessageText", () => {
  it("leaves a message without drafts as written", () => {
    expect(readAloudMessageText(assistant("## Done\n\nThe timer is fixed."))).toBe("## Done\n\nThe timer is fixed.");
  });

  it("writes a drafted post out as one <draft> section where its first block was", () => {
    // A ```draft fence looks like code to the rewrite, which leaves code out, so the draft was
    // never heard. The section keeps the post's title, where it goes (by name, not link), each
    // part's label and attached files, and the prose around it stays in place.
    const content = [
      "Here's the update for the thread.",
      "",
      "```draft",
      "title: T7 eval start",
      "to: [#evals thread](https://example.slack.com/archives/C1/p1)",
      "---",
      "Evals start at **iter 2**.",
      "```",
      "",
      "```draft",
      "Numbers so far are in the sheet.",
      "attach: /tmp/plots/t7-curve.png",
      "```",
      "",
      "Tell me if you want it shorter.",
    ].join("\n");

    expect(readAloudMessageText(assistant(content))).toBe(
      [
        "Here's the update for the thread.",
        "",
        "<draft>",
        "Title: T7 eval start",
        "Goes to: #evals thread",
        "",
        "Message:",
        "Evals start at **iter 2**.",
        "",
        "Reply 1:",
        "Numbers so far are in the sheet.",
        "(Attached file: t7-curve.png)",
        "</draft>",
        "",
        "",
        "",
        "Tell me if you want it shorter.",
      ].join("\n"),
    );
  });

  it("reads a revision's parts under the labels they replace", () => {
    const content = "```draft\ntitle: Launch note\npart: 2\n---\nNew second paragraph.\n```";
    expect(readAloudMessageText(assistant(content))).toBe(
      "<draft>\nTitle: Launch note\nNew second paragraph.\n</draft>",
    );
    const twoParts = "```draft\ntitle: Launch note\npart: 2\n---\nReply text.\n```\n```draft\npart: 3\n---\nMore.\n```";
    expect(readAloudMessageText(assistant(twoParts))).toContain("Reply 1:\nReply text.\n\nReply 2:\nMore.");
  });

  it("reads a shared draft's post, which arrives as a report", () => {
    const [message] = normalizeHistoryMessageToChatMessages(makeSharedDraftFixture(), 0);
    const text = readAloudMessageText(message!);
    expect(text).toContain("<draft>\nTitle: Cache rollout update\nGoes to: #cache-rollout thread");
    expect(text).toContain("Hit rate settled at 92% after a day.");
    expect(text).not.toContain("```");
  });
});

describe("readAloudDraftText", () => {
  it("reads a single-part post without a part label", () => {
    expect(
      readAloudDraftText({
        parts: [{ label: "Message", text: "Hi all.", attachments: [] }],
      }),
    ).toBe("<draft>\nHi all.\n</draft>");
  });
});

describe("readAloudQuestionText", () => {
  // The rewrite reads a <question> section out in full, so the card's title, numbered questions and
  // each one's suggested answers must all be in it.
  it("writes out a card's title and each question with its suggested answers", () => {
    const text = readAloudQuestionText({
      summary: "Batch 2: what to do?",
      questions: [
        { prompt: "How should batch 2 handle the 11 tasks?", suggestedAnswers: ["Launch all", "Hold them back"] },
        { prompt: "Pair every structure with lemmas?", suggestedAnswers: ["Yes", "No"] },
      ],
    });
    expect(text).toBe(
      [
        "<question>",
        "Title: Batch 2: what to do?",
        "1. How should batch 2 handle the 11 tasks?",
        "Suggested answers: Launch all; Hold them back",
        "2. Pair every structure with lemmas?",
        "Suggested answers: Yes; No",
        "</question>",
      ].join("\n"),
    );
  });

  it("reads an older single prompt, whose title is the question", () => {
    expect(readAloudQuestionText({ summary: "Deploy now?", suggestedAnswers: ["yes", "no"] })).toBe(
      "<question>\nTitle: Deploy now?\nSuggested answers: yes; no\n</question>",
    );
  });
});
