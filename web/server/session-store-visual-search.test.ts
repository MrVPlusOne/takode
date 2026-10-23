import { describe, expect, it } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";

describe("SessionStore visual block search excerpts", () => {
  it("indexes a visual block as its plain-text version, not its HTML", () => {
    // Searching "div" or a kit class must not match every answer with a visual; its alt text should.
    const text =
      'The flow:\n\n```visual\ntitle: Landing\nalt: Submit, test once, push.\n---\n<div class="tk-flow"></div>\n```';
    const messages = [
      {
        type: "assistant",
        message: {
          id: "a1",
          role: "assistant",
          model: "test",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: {},
        },
        parent_tool_use_id: null,
        timestamp: 10,
      },
    ] as PersistedSession["messageHistory"];
    const [excerpt] = SessionStore.extractSearchExcerpts(messages);
    expect(excerpt?.content).toBe("The flow:\n\n[Visual] Landing: Submit, test once, push.");
  });
});
