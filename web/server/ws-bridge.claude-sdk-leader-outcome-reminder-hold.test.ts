import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WsBridge, type SocketData } from "./ws-bridge.js";
import { createClaudeSdkTestBackend, type ClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { SessionStore } from "./session-store.js";
import { subscribeCurrentBrowser } from "./ws-bridge-current-browser-test-helpers.js";

/**
 * A Claude leader takes every prompt Takode sends at once and queues the ones that arrive mid-turn.
 * An answer reminder sent while Claude still had another prompt to run used to wait in that
 * queue: the turn ahead of it could answer the request, and the leader then got a stale reminder
 * and answered the same request twice. These tests replay that sequence through the real Claude
 * adapter and check that Takode holds the reminder and re-checks it once Claude is idle.
 */
describe("Claude leader answer reminders held while Claude is busy", () => {
  let tempDir: string;
  let bridge: WsBridge;
  let cli: ClaudeSdkTestBackend;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "leader-reminder-hold-"));
    bridge = new WsBridge();
    bridge.store = new SessionStore(tempDir);
    bridge.launcher = {
      touchActivity: vi.fn(),
      touchUserMessage: vi.fn(),
      getSession: vi.fn(() => ({ isOrchestrator: true })),
    } as any;
    cli = createClaudeSdkTestBackend("leader").attach(bridge);
    const browser = { data: { kind: "browser", sessionId: "leader" } as SocketData, send: vi.fn(), close: vi.fn() };
    bridge.handleBrowserOpen(browser as any, "leader");
    await subscribeCurrentBrowser(bridge, browser as any);
    // The user's request starts the first turn.
    bridge.handleBrowserMessage(browser as any, JSON.stringify({ type: "user_message", content: "Look into this." }));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Claude's uuid for the nth prompt Takode handed it (the result lists the ones a turn consumed). */
  const promptUuid = (index: number) => (cli.userTurns.mock.calls[index]![0] as { uuid: string }).uuid;
  const reminderPrompts = () => cli.promptTexts().filter((text) => text.includes("Answer reminder"));

  function assistant(id: string, text: string) {
    cli.message(
      JSON.stringify({
        type: "assistant",
        message: {
          id,
          type: "message",
          role: "assistant",
          model: "claude-opus",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: "cli",
      }),
    );
  }

  function result(consumedPromptIndexes: number[]) {
    cli.message(
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "",
        is_error: false,
        stop_reason: "end_turn",
        total_cost_usd: 0,
        num_turns: 1,
        session_id: "cli",
        user_message_uuids: consumedPromptIndexes.map(promptUuid),
      }),
    );
  }

  /** The first turn posts commentary only, while a herd event reaches Claude and waits behind it. */
  function firstTurnLeavesRequestPendingWithHerdQueued() {
    assistant("a-1", "[thread:main:C] I'm looking into it.");
    bridge.injectUserMessage("leader", "1 event from 1 session", { sessionId: "herd-events", sessionLabel: "Herd" });
    expect(cli.userTurns).toHaveBeenCalledTimes(2);
    result([0]);
  }

  it("drops the held reminder when the queued turn answers the request", () => {
    firstTurnLeavesRequestPendingWithHerdQueued();
    // u1 is still unanswered, but Claude has the herd turn to run first: the reminder is held.
    expect(reminderPrompts()).toEqual([]);
    expect(bridge.getSession("leader")!.heldLeaderThreadOutcomeReminders).toHaveLength(1);

    // The herd turn answers u1, so the held reminder is stale when Claude goes idle.
    assistant("a-2", "[thread:main:A:u1] Here is what I found.\n\n{[(Thread Ready: main | answered)]}");
    result([1]);

    expect(reminderPrompts()).toEqual([]);
    expect(bridge.getSession("leader")!.heldLeaderThreadOutcomeReminders).toEqual([]);
  });

  it("delivers the held reminder once, when Claude is idle, if the request is still unanswered", () => {
    firstTurnLeavesRequestPendingWithHerdQueued();
    expect(reminderPrompts()).toEqual([]);

    // The herd turn works elsewhere and leaves u1 unanswered.
    assistant("a-2", "[thread:q-7:C] The worker finished.\n\n{[(Thread Ready: q-7 | worker done)]}");
    result([1]);

    const reminders = reminderPrompts();
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toContain("Pending answer IDs: Main (u1).");
    expect(bridge.getSession("leader")!.heldLeaderThreadOutcomeReminders).toEqual([]);
  });
});
