import { describe, expect, it } from "vitest";
import { readSessionDraftWriteRequest, readSessionDraftsState } from "./session-drafts.js";

// Guided review drafts arrive from browsers and are reloaded from disk; both paths keep valid line
// comments as written and refuse or drop malformed ones.
describe("guided review line comments in drafts", () => {
  const comment = {
    id: "c1",
    stop: 1,
    path: "src/client.ts",
    lines: [5, 7],
    removedLines: [4, 4],
    code: "-old()\n+new()",
    comment: "Why?",
  };
  const write = (draft: unknown) =>
    readSessionDraftWriteRequest({ clientId: "tab", write: { kind: "guided-review", reviewId: "r1", draft } });

  it("keeps a draft whose only content is a line comment", () => {
    expect(write({ answers: {}, lineComments: [comment] })).toEqual({
      clientId: "tab",
      write: { kind: "guided-review", reviewId: "r1", draft: { answers: {}, lineComments: [comment] } },
    });
  });

  it("refuses a comment without lines, with a reversed range or with an empty comment", () => {
    const { lines: _lines, removedLines: _removedLines, ...noLines } = comment;
    expect(write({ answers: {}, lineComments: [noLines] })).toHaveProperty("error");
    expect(write({ answers: {}, lineComments: [{ ...comment, lines: [7, 5] }] })).toHaveProperty("error");
    expect(write({ answers: {}, lineComments: [{ ...comment, comment: "  " }] })).toHaveProperty("error");
  });

  it("reloads saved line comments", () => {
    const meta = { revision: 3, clientId: "tab", updatedAt: 1 };
    const state = readSessionDraftsState({
      revision: 3,
      guidedReviews: { r1: { ...meta, draft: { answers: {}, lineComments: [comment], sentAt: 9 } } },
    });
    expect(state?.guidedReviews?.r1.draft).toEqual({ answers: {}, lineComments: [comment], sentAt: 9 });
  });
});

// The side column's message box drafts are saved with the session and reloaded by place.
describe("side message box drafts", () => {
  it("reloads saved side drafts, dropping ones with an unknown place or nothing in them", () => {
    const meta = { revision: 2, clientId: "tab", updatedAt: 1 };
    const state = readSessionDraftsState({
      revision: 2,
      composer: { ...meta, draft: { text: "main" } },
      sideComposers: {
        new: { ...meta, draft: { text: "a new side chat" } },
        "q-7": { ...meta, draft: { text: "beside q-7" } },
        "../q-1": { ...meta, draft: { text: "bad place" } },
        "topic:aaaa0001": { ...meta, draft: { text: "" } },
      },
    });
    expect(state?.composer?.draft).toEqual({ text: "main" });
    expect(Object.keys(state?.sideComposers ?? {})).toEqual(["new", "q-7"]);
  });
});
