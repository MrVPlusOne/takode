import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import { filterMessagesForThread } from "./thread-projection.js";

function message(id: string, metadata: NonNullable<ChatMessage["metadata"]>): ChatMessage {
  return {
    id,
    role: "system",
    content: id,
    timestamp: 1,
    metadata,
  };
}

describe("thread system marker projection", () => {
  it("keeps useful activity in a marker run and leaves attachment audit markers out", () => {
    // A quest thread shows cross-thread activity detail; attachment markers stay audit-only.
    const attachment = message("attachment", {
      threadAttachmentMarker: {
        type: "thread_attachment_marker",
        id: "attachment",
        timestamp: 1,
        markerKey: "thread-attachment:q-1752:context",
        threadKey: "q-1752",
        questId: "q-1752",
        attachedAt: 1,
        attachedBy: "leader",
        messageIds: ["context"],
        messageIndices: [1],
        ranges: ["1"],
        count: 1,
        firstMessageId: "context",
        firstMessageIndex: 1,
      },
    });
    const activity = message("activity", {
      threadKey: "q-1752",
      questId: "q-1752",
      crossThreadActivityMarker: {
        threadKey: "q-1752",
        questId: "q-1752",
        count: 1,
        firstMessageId: "activity-source",
        lastMessageId: "activity-source",
        summary: "Useful activity detail",
        startedAt: 1,
        updatedAt: 1,
      },
    });

    expect(filterMessagesForThread([attachment, activity], "q-1752").map(({ id }) => id)).toEqual(["activity"]);
  });
});
