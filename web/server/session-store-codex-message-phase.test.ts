import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";
import type { BrowserIncomingMessage } from "./session-types.js";

function assistant(
  id: string,
  text: string,
  codexMessagePhase: "commentary" | "final_answer",
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    codexMessagePhase,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.6-sol",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 2,
  };
}

function successfulResult(): BrowserIncomingMessage {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: "result-1",
      session_id: "phase-roundtrip",
    },
  };
}

describe("SessionStore Codex message phases", () => {
  it("round-trips phases through frozen JSONL and the hot message tail", async () => {
    // The completed answer crosses the append-only freeze boundary while later
    // commentary remains hot, covering both persistence tiers without rewriting legacy rows.
    const directory = await mkdtemp(join(tmpdir(), "takode-codex-message-phase-"));
    try {
      const history: BrowserIncomingMessage[] = [
        { type: "user_message", id: "user-1", content: "Start", timestamp: 1 },
        assistant("codex-agent-final", "Finished", "final_answer"),
        successfulResult(),
        { type: "user_message", id: "user-2", content: "Continue", timestamp: 3 },
        assistant("codex-agent-commentary", "Checking", "commentary"),
      ];
      const session = {
        id: "phase-roundtrip",
        state: { session_id: "phase-roundtrip", backend_type: "codex", cwd: "/tmp", model: "gpt-5.6-sol" },
        messageHistory: history,
        pendingMessages: [],
        pendingPermissions: [],
      } as unknown as PersistedSession;

      const store = new SessionStore(directory);
      await store.saveSync(session);
      await store.flushAll();

      const restored = await new SessionStore(directory).load(session.id);
      const phases = restored?.messageHistory.flatMap((message) =>
        message.type === "assistant" ? [message.codexMessagePhase] : [],
      );
      expect(phases).toEqual(["final_answer", "commentary"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
