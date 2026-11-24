import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CONTEXT_IMAGE_BUDGET_CHARS } from "./bridge/claude-image-compaction.js";
import { buildPersistedSessionPayload } from "./bridge/session-registry-controller.js";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { SessionStore } from "./session-store.js";
import { WsBridge } from "./ws-bridge.js";

// Claude Code resends every image in a session's context with each model
// request. A CAD session on the laptop read ~11 MB of renders, and Copilot then
// failed every request (408, body not read within 60 s) while token-based
// auto-compaction was nowhere near. Takode counts the image data in the
// session's context and compacts before the next turn once it passes a budget.

/** A Read tool result carrying an image of `chars` base64 characters, as Claude Code streams it. */
function imageToolResult(id: string, chars: number, parentToolUseId: string | null = null): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `toolu_${id}`,
          content: [{ type: "image", source: { type: "base64", media_type: "image/webp", data: "A".repeat(chars) } }],
        },
      ],
    },
    parent_tool_use_id: parentToolUseId,
    session_id: "cli-s1",
    uuid: `tool-result-${id}`,
  });
}

function result(uuid: string, text: string): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    stop_reason: "end_turn",
    duration_ms: 10,
    duration_api_ms: 10,
    num_turns: 1,
    total_cost_usd: 0,
    session_id: "cli-s1",
    uuid,
  });
}

// What Claude Code 2.1.311 streams for `/compact` (checked against a local fake API).
const COMPACT_BOUNDARY = JSON.stringify({
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: { trigger: "manual", pre_tokens: 90_000 },
  session_id: "cli-s1",
  uuid: "boundary-1",
});

let bridge: WsBridge;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-sdk-image-compaction-test-"));
  bridge = new WsBridge();
  bridge.store = new SessionStore(tempDir);
  bridge.onCLIRelaunchNeeded = vi.fn();
});

afterEach(async () => {
  await bridge.store!.flushAll();
  rmSync(tempDir, { recursive: true, force: true });
});

function startSession() {
  const session = bridge.getOrCreateSession("s1", "claude-sdk");
  const backend = createClaudeSdkTestBackend("s1").attach(bridge);
  vi.spyOn(bridge as any, "broadcastToBrowsers").mockImplementation(() => {});
  return { session, backend };
}

/** One turn in which the agent reads images of the given sizes. */
function turnReadingImages(backend: ReturnType<typeof startSession>["backend"], sizes: number[], turn: string) {
  bridge.injectUserMessage("s1", `turn ${turn}`);
  sizes.forEach((chars, i) => backend.message(imageToolResult(`${turn}-${i}`, chars)));
  backend.message(result(`result-${turn}`, "done"));
}

describe("Claude SDK image compaction", () => {
  it("compacts before the next turn once the context's images pass the budget", () => {
    const { session, backend } = startSession();
    const half = CLAUDE_CONTEXT_IMAGE_BUDGET_CHARS / 2;

    // Under the budget nothing happens.
    turnReadingImages(backend, [half], "1");
    expect(session.state.claude_context_image_chars).toBe(half);
    backend.clearSent();
    turnReadingImages(backend, [half - 1], "2");
    expect(backend.promptTexts()).toEqual([expect.stringContaining("turn 2")]);
    expect(session.isGenerating).toBe(false);

    // Past it, `/compact` goes just ahead of the turn's message.
    backend.message(imageToolResult("extra", 1));
    backend.clearSent();
    bridge.injectUserMessage("s1", "turn 3");
    expect(backend.promptTexts()).toEqual(["/compact", expect.stringContaining("turn 3")]);

    // The compaction's own result does not end the turn; the message's does.
    backend.message(COMPACT_BOUNDARY);
    expect(session.state.claude_context_image_chars).toBe(0);
    backend.message(result("result-compact", ""));
    expect(session.isGenerating).toBe(true);
    backend.message(result("result-3", "done"));
    expect(session.isGenerating).toBe(false);

    // Counting starts over, so the next turn goes without one.
    backend.clearSent();
    bridge.injectUserMessage("s1", "turn 4");
    expect(backend.promptTexts()).toEqual([expect.stringContaining("turn 4")]);
  });

  it("does not compact for input that joins a running turn", () => {
    const { backend } = startSession();
    bridge.injectUserMessage("s1", "turn 1");
    backend.message(imageToolResult("big", CLAUDE_CONTEXT_IMAGE_BUDGET_CHARS));
    backend.clearSent();

    bridge.injectUserMessage("s1", "also look at this");

    expect(backend.promptTexts()).not.toContain("/compact");
  });

  it("counts only the session's own context, not its sub-agents'", () => {
    // A sub-agent's images stay in the sub-agent's context; only its final text comes back.
    const { session, backend } = startSession();
    bridge.injectUserMessage("s1", "turn 1");
    backend.message(imageToolResult("sub", CLAUDE_CONTEXT_IMAGE_BUDGET_CHARS, "toolu_agent"));
    backend.message(result("result-1", "done"));

    expect(session.state.claude_context_image_chars ?? 0).toBe(0);
  });

  it("keeps the count across server restarts", () => {
    // The images stay in Claude's saved conversation, so a restored session must not forget them.
    const { session, backend } = startSession();
    turnReadingImages(backend, [1234], "1");

    expect(buildPersistedSessionPayload(session as any).state.claude_context_image_chars).toBe(1234);
  });
});
