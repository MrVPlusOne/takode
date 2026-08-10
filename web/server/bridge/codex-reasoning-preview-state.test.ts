import { describe, expect, it } from "vitest";
import {
  clearCodexReasoningPreviewForRoute,
  listCodexReasoningPreviews,
  retainCodexReasoningPreview,
  type CodexReasoningPreviewSession,
} from "./codex-reasoning-preview-state.js";

describe("Codex reasoning preview state", () => {
  it("retains one latest row per normalized thread and clears only the routed thread", () => {
    // Per-thread retention is the core lifecycle contract: cross-thread
    // activity must not create blank gaps in a different thread tab.
    const session: CodexReasoningPreviewSession = {};

    expect(
      retainCodexReasoningPreview(session, {
        text: "Main reasoning",
        updatedAt: 1,
        threadKey: "main",
      }),
    ).toBe(true);
    retainCodexReasoningPreview(session, {
      text: "First quest reasoning",
      updatedAt: 2,
      threadKey: "q-975",
      questId: "q-975",
    });
    retainCodexReasoningPreview(session, {
      text: "Replacement quest reasoning",
      updatedAt: 3,
      threadKey: "q-975",
      questId: "q-975",
    });

    expect(listCodexReasoningPreviews(session).map((preview) => preview.text)).toEqual([
      "Main reasoning",
      "Replacement quest reasoning",
    ]);
    expect(clearCodexReasoningPreviewForRoute(session, { threadKey: "q-975", questId: "q-975" })).toBe(true);
    expect(listCodexReasoningPreviews(session).map((preview) => preview.text)).toEqual(["Main reasoning"]);
  });

  it("retires the matching delta accumulator without touching another thread", () => {
    const session: CodexReasoningPreviewSession = {
      activeCodexReasoningPreview: {
        text: "Quest reasoning",
        updatedAt: 2,
        threadKey: "q-975",
        questId: "q-975",
      },
      codexReasoningPreviews: {
        main: { text: "Main reasoning", updatedAt: 1, threadKey: "main" },
        "q-975": {
          text: "Quest reasoning",
          updatedAt: 2,
          threadKey: "q-975",
          questId: "q-975",
        },
      },
    };

    clearCodexReasoningPreviewForRoute(session, { threadKey: "q-975" });

    expect(session.activeCodexReasoningPreview).toBeNull();
    expect(session.codexReasoningPreviews).toEqual({
      main: { text: "Main reasoning", updatedAt: 1, threadKey: "main" },
    });
  });
});
