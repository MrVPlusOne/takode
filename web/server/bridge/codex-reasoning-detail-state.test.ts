import { describe, expect, it } from "vitest";
import { upsertCodexReasoningDetail } from "./codex-reasoning-detail-state.js";
import type { BrowserIncomingMessage, CodexReasoningDetailMessage } from "../session-types.js";

function detail(text: string, status: "streaming" | "complete", timestamp: number): CodexReasoningDetailMessage {
  return {
    type: "codex_reasoning_detail",
    id: "codex-reasoning-r1",
    text,
    status,
    timestamp,
    parent_tool_use_id: null,
    threadKey: "q-1842",
    questId: "q-1842",
  };
}

describe("Codex reasoning detail state", () => {
  it("streams and completes one stable chronological history entry", () => {
    const session = { messageHistory: [] as BrowserIncomingMessage[] };

    expect(upsertCodexReasoningDetail(session, detail("Partial", "streaming", 10))).toMatchObject({
      changed: true,
      activityChanged: true,
      inserted: true,
    });
    expect(upsertCodexReasoningDetail(session, detail("Partial summary", "streaming", 11))).toMatchObject({
      changed: true,
      activityChanged: true,
      inserted: false,
    });
    expect(upsertCodexReasoningDetail(session, detail("Partial summary", "complete", 12))).toMatchObject({
      changed: true,
      activityChanged: true,
      inserted: false,
    });

    expect(session.messageHistory).toEqual([
      expect.objectContaining({ text: "Partial summary", status: "complete", timestamp: 10 }),
    ]);
  });

  it("does not regress a completed row during resume replay", () => {
    const session = { messageHistory: [detail("Complete summary", "complete", 10)] as BrowserIncomingMessage[] };

    const update = upsertCodexReasoningDetail(session, detail("Complete", "streaming", 20));

    expect(update.changed).toBe(false);
    expect(session.messageHistory).toEqual([
      expect.objectContaining({ text: "Complete summary", status: "complete", timestamp: 10 }),
    ]);
  });

  it("separates route-only replay enrichment from fresh reasoning activity", () => {
    const session = { messageHistory: [detail("Complete", "complete", 10)] as BrowserIncomingMessage[] };

    const update = upsertCodexReasoningDetail(session, {
      ...detail("Complete", "complete", 20),
      threadKey: "q-1851",
      questId: "q-1851",
    });

    expect(update).toMatchObject({ changed: true, activityChanged: false, inserted: false });
  });

  it("reuses the persisted identity for completion-only replay after an ordinal reset", () => {
    const existing = {
      ...detail("Second occurrence", "complete", 10),
      id: "codex-reasoning-turn-1-1-0",
      reasoning_turn_id: "turn-1",
      reasoning_item_ordinal: 1,
      provider_item_id: "completed-provider-item",
      summary_index: 0,
    };
    const session = { messageHistory: [existing] as BrowserIncomingMessage[] };

    const update = upsertCodexReasoningDetail(session, {
      ...existing,
      id: "codex-reasoning-turn-1-0-0",
      reasoning_item_ordinal: 0,
      timestamp: 20,
    });

    expect(update.changed).toBe(false);
    expect(session.messageHistory).toEqual([existing]);
  });
});
