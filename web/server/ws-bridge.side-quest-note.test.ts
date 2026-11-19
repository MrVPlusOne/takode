import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));
// The memory catalog a fresh conversation gets is not what these tests check.
vi.mock("./memory-catalog-injection.js", () => ({ buildMemoryCatalogInjectionBundle: async () => null }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";
import { questSources } from "./quest-source-index.js";
import { SessionStore } from "./session-store.js";
import { WsBridge } from "./ws-bridge.js";
import type { BoardRow } from "./session-types.js";

// A leader learns where a side quest's result goes from the messages it gets about that quest,
// such as its worker's events, instead of working it out from the rules each time. These tests
// drive the real bridge: q-43 is a side quest filed from the user's request u1 in q-42's thread.

const HERD = { sessionId: "herd-events", sessionLabel: "Herd Events" };
let bridge: WsBridge;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "side-quest-note-bridge-test-"));
  bridge = new WsBridge();
  bridge.store = new SessionStore(tempDir);
  bridge.onCLIRelaunchNeeded = vi.fn();
  bridge.launcher = {
    touchActivity: vi.fn(),
    touchUserMessage: vi.fn(),
    setCLISessionId: vi.fn(),
    getSession: vi.fn(() => ({
      sessionId: "leader",
      state: "connected",
      backendType: "claude-sdk",
      isOrchestrator: true,
    })),
    takeRecovery: vi.fn(),
  } as any;
  questSources.record([
    {
      questId: "q-43",
      relationships: { startedFrom: { sessionId: "leader", messageId: "raw-u1", threadKey: "q-42", timestamp: 10 } },
    },
  ]);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function leaderWithSideQuest() {
  const session = bridge.getOrCreateSession("leader", "claude-sdk");
  session.messageHistory.push({
    type: "user_message",
    id: "raw-u1",
    leaderUserMessageId: "u1",
    content: "Is the run healthy, and are any branches unmerged?",
    timestamp: 10,
    threadKey: "q-42",
    questId: "q-42",
    leaderResponseCoverageVersion: 1,
  });
  session.board.set("q-43", { questId: "q-43", createdAt: 15, updatedAt: 15 } as BoardRow);
  return createClaudeSdkTestBackend("leader").attach(bridge);
}

describe("messages a leader gets in a side quest's thread", () => {
  it("say whose side quest it is and which request its result answers", () => {
    const backend = leaderWithSideQuest();
    bridge.injectUserMessage("leader", "1 event from 1 session  #9 | turn_end", HERD, undefined, {
      threadKey: "q-43",
      questId: "q-43",
    });
    expect(backend.promptTexts().at(-1)).toContain(
      "q-43 is a side quest of q-42: when its result is ready, post it in q-42 as an answer to u1.",
    );
  });

  it("add nothing in other threads", () => {
    const backend = leaderWithSideQuest();
    bridge.injectUserMessage("leader", "1 event from 1 session  #8 | turn_end", HERD, undefined, {
      threadKey: "q-42",
      questId: "q-42",
    });
    expect(backend.promptTexts().at(-1)).not.toContain("side quest");
  });
});
