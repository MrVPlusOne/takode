import { describe, expect, it } from "vitest";
import {
  computeSessionSearchMatches,
  getSessionSearchState,
  sessionSearchMessageMatchesCategory,
} from "./store-session-search.js";
import { COMPACTION_RECOVERY_SOURCE_ID, LEADER_KICKOFF_SOURCE_ID } from "../shared/injected-event-message.js";

describe("store session search helpers", () => {
  it("returns default state for sessions without local search state", () => {
    // Fresh sessions should start with a closed, empty search model instead of
    // inheriting stale state from a previous tab or test run.
    expect(getSessionSearchState({ sessionSearch: new Map() }, "s1")).toMatchObject({
      query: "",
      isOpen: false,
      matches: [],
      currentMatchIndex: -1,
    });
  });

  it("matches strict searches by normalized substring", () => {
    // Strict mode still normalizes punctuation/casing so copied snippets from
    // rendered markdown remain searchable in the raw message text.
    expect(
      computeSessionSearchMatches(
        [{ id: "m1", role: "assistant", content: "Fix ws-bridge replay handling" }],
        "replay handling",
        "strict",
      ),
    ).toEqual([{ messageId: "m1" }]);
  });

  it("matches fuzzy searches by requiring every query token", () => {
    // Fuzzy mode is intentionally forgiving on spacing/order but still requires
    // all meaningful tokens so broad queries do not over-highlight the feed.
    expect(
      computeSessionSearchMatches(
        [{ id: "m1", role: "assistant", content: "Refactor message feed scroll anchoring" }],
        "feed anchor",
        "fuzzy",
      ),
    ).toEqual([{ messageId: "m1" }]);
  });

  it("intentionally keeps normalized substring matching for in-chat search", () => {
    // Questmaster search is token-aware, but in-chat search stays broad so
    // small pasted fragments can still find message text.
    expect(
      computeSessionSearchMatches(
        [{ id: "m1", role: "assistant", content: "Guidance required before rollout" }],
        "ui",
        "fuzzy",
      ),
    ).toEqual([{ messageId: "m1" }]);
    expect(
      computeSessionSearchMatches(
        [{ id: "m1", role: "assistant", content: "Guidance required before rollout" }],
        "ui",
        "strict",
      ),
    ).toEqual([{ messageId: "m1" }]);
  });

  it("matches non-ASCII text and ignores punctuation-only queries", () => {
    expect(
      computeSessionSearchMatches([{ id: "m1", role: "assistant", content: "修复 记忆 搜索" }], "记忆", "strict"),
    ).toEqual([{ messageId: "m1" }]);

    expect(
      computeSessionSearchMatches([{ id: "m1", role: "assistant", content: "anything" }], "!!!", "strict"),
    ).toEqual([]);
  });

  it("classifies injected pseudo-user messages as events for category filtering", () => {
    expect(
      computeSessionSearchMatches(
        [
          { id: "m1", role: "user", content: "real user request" },
          { id: "m2", role: "user", content: "timer fired", agentSource: { sessionId: "timer:t1" } },
          { id: "m3", role: "system", content: "permission approved" },
          { id: "m4", role: "user", content: "agent reminder", agentSource: { sessionId: "agent-1" } },
        ],
        "r",
        "strict",
        "event",
        "leader-1",
      ),
    ).toEqual([{ messageId: "m2" }, { messageId: "m3" }, { messageId: "m4" }]);
  });

  it("classifies compaction recovery and leader kickoff injections as events", () => {
    const messages = [
      {
        id: "m1",
        role: "user" as const,
        content:
          "Context was compacted. Before continuing, recover enough context from your own session history to safely resume work:",
        agentSource: { sessionId: COMPACTION_RECOVERY_SOURCE_ID },
      },
      {
        id: "m2",
        role: "user" as const,
        content: "[System] You are a leader session. Your job is to coordinate worker sessions.",
        agentSource: { sessionId: LEADER_KICKOFF_SOURCE_ID },
      },
      {
        id: "m3",
        role: "user" as const,
        content: "[System] You are a leader session. Historical kickoff context without metadata.",
      },
      { id: "m4", role: "user" as const, content: "real user context" },
    ];

    expect(computeSessionSearchMatches(messages, "context", "strict", "user", "leader-1")).toEqual([
      { messageId: "m4" },
    ]);
    expect(computeSessionSearchMatches(messages, "context", "strict", "event", "leader-1")).toEqual([
      { messageId: "m1" },
      { messageId: "m3" },
    ]);
    expect(computeSessionSearchMatches(messages, "context", "strict", "all", "leader-1")).toEqual([
      { messageId: "m1" },
      { messageId: "m3" },
      { messageId: "m4" },
    ]);
  });

  it("keeps only the active leader injection in the user category", () => {
    expect(
      sessionSearchMessageMatchesCategory({ role: "user", agentSource: { sessionId: "leader-1" } }, "user", "leader-1"),
    ).toBe(true);
    expect(
      sessionSearchMessageMatchesCategory(
        { role: "user", agentSource: { sessionId: "leader-1" } },
        "event",
        "leader-1",
      ),
    ).toBe(false);
    expect(
      sessionSearchMessageMatchesCategory({ role: "user", agentSource: { sessionId: "agent-1" } }, "user", "leader-1"),
    ).toBe(false);
    expect(
      sessionSearchMessageMatchesCategory({ role: "user", agentSource: { sessionId: "agent-1" } }, "event", "leader-1"),
    ).toBe(true);
  });
});
