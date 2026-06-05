import { describe, expect, it } from "vitest";
import type { SlackThreadChildState, SlackThreadRecord } from "./types.js";

describe("frontend Side Chat compatibility type facade", () => {
  it("keeps deprecated SlackThread type exports available for older callers", () => {
    const record: SlackThreadRecord = {
      id: "st-compat",
      rootSessionId: "root",
      childSessionId: "child",
      anchorMessageId: "assistant-1",
      anchorHistoryIndex: 1,
      anchorPreview: "Root answer",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 0,
      seeded: true,
    };
    const child: SlackThreadChildState = {
      rootSessionId: "root",
      threadId: record.id,
      anchorMessageId: record.anchorMessageId,
      anchorHistoryIndex: record.anchorHistoryIndex,
      readOnly: true,
    };

    expect(child.threadId).toBe(record.id);
  });
});
