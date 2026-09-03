import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "./session-types.js";
import {
  buildLeaderUserMessageIdentities,
  findLeaderUserMessageById,
  nextLeaderUserMessageId,
} from "./leader-user-message-id.js";

function human(id: string, leaderUserMessageId?: string): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: id,
    timestamp: 1,
    leaderResponseCoverageVersion: 1,
    ...(leaderUserMessageId ? { leaderUserMessageId } : {}),
  };
}

describe("leader user-message IDs", () => {
  it("assigns deterministic virtual ordinals to legacy rows and continues persisted IDs", () => {
    // Older post-cutover rows remain addressable without rewriting durable history.
    const history = [human("legacy-a"), human("legacy-b"), human("new-c", "u3")] as BrowserIncomingMessage[];

    expect(buildLeaderUserMessageIdentities(history).map((entry) => entry.userMessageId)).toEqual(["u1", "u2", "u3"]);
    expect(nextLeaderUserMessageId(history)).toBe("u4");
    expect(nextLeaderUserMessageId(history, ["u8", undefined])).toBe("u9");
    expect(findLeaderUserMessageById(history, "u2")?.historyMessageId).toBe("legacy-b");
  });

  it("fails closed on duplicate persisted IDs without losing unique session-local lookup", () => {
    // Corrupted duplicate envelopes must not resolve ambiguously or steal another row's ID.
    const history = [human("a", "u1"), human("b", "u1"), human("c", "u4")] as BrowserIncomingMessage[];

    expect(buildLeaderUserMessageIdentities(history).map((entry) => entry.userMessageId)).toEqual(["u2", "u3", "u4"]);
    expect(findLeaderUserMessageById(history, "u1")).toBeNull();
    expect(nextLeaderUserMessageId(history)).toBe("u5");
  });

  it("never reissues a high duplicated persisted ID", () => {
    // Reservation uses every persisted ID, even when duplicate proof makes it unresolvable.
    const history = [human("a", "u100"), human("b", "u100"), human("c")] as BrowserIncomingMessage[];

    expect(buildLeaderUserMessageIdentities(history).map((entry) => entry.userMessageId)).toEqual(["u1", "u2", "u3"]);
    expect(findLeaderUserMessageById(history, "u100")).toBeNull();
    expect(nextLeaderUserMessageId(history)).toBe("u101");
  });

  it("excludes synthetic, child-owned, and pre-cutover messages", () => {
    // Only direct root human input delivered under the new leader contract receives uN identity.
    const synthetic = { ...human("synthetic"), agentSource: { sessionId: "worker" } } as BrowserIncomingMessage;
    const child = {
      ...human("child"),
      codexSubagent: { childId: "child-1", rootTurnId: "root-turn" },
    } as BrowserIncomingMessage;
    const old = { type: "user_message", id: "old", content: "old", timestamp: 1 } as BrowserIncomingMessage;

    expect(buildLeaderUserMessageIdentities([synthetic, child, old, human("direct")])).toMatchObject([
      { userMessageId: "u1", historyMessageId: "direct" },
    ]);
  });
});
