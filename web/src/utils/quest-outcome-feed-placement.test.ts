import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types.js";
import type { Turn } from "../hooks/use-feed-model.js";
import { placeQuestOutcomeInFeed } from "./quest-outcome-feed-placement.js";

function turn(id: string, historyIndex: number, messageId = id): Turn {
  const msg: ChatMessage = { id: messageId, role: "assistant", content: id, timestamp: historyIndex, historyIndex };
  const entry = { kind: "message" as const, msg };
  return {
    id,
    userEntry: null,
    allEntries: [entry],
    agentEntries: [entry],
    systemEntries: [],
    notificationEntries: [],
    responseEntry: entry,
    subConclusions: [],
    stats: { messageCount: 1, toolCount: 0, subagentCount: 0, herdEventCount: 0 },
  };
}

const sections = [{ id: "section", turns: [turn("t1", 3, "a1"), turn("t2", 7, "a2"), turn("t3", 12, "a3")] }];

describe("placeQuestOutcomeInFeed", () => {
  it("places after the exact anchor turn and leaves later activity below", () => {
    const placement = placeQuestOutcomeInFeed({
      sections,
      anchor: { sessionId: "leader", historyIndex: 7, messageId: "a2" },
      sessionId: "leader",
      hasNewerItems: false,
    });
    expect(placement.kind).toBe("before-turn");
    expect(placement.kind === "before-turn" ? placement.turnId : null).toBe("t3");
    expect([...placement.coveredTurnIds]).toEqual(["t1", "t2"]);
    expect([...placement.newerTurnIds]).toEqual(["t3"]);
  });

  it("puts the card before a window that starts after its hidden boundary", () => {
    const placement = placeQuestOutcomeInFeed({
      sections,
      anchor: { sessionId: "leader", historyIndex: 1 },
      sessionId: "leader",
      hasNewerItems: false,
    });
    expect(placement.kind).toBe("before-turn");
    expect(placement.kind === "before-turn" ? placement.turnId : null).toBe("t1");
  });

  it("omits the card from an older partial window instead of placing it after stale activity", () => {
    const placement = placeQuestOutcomeInFeed({
      sections,
      anchor: { sessionId: "leader", historyIndex: 20 },
      sessionId: "leader",
      hasNewerItems: true,
    });
    expect(placement.kind).toBe("hidden");
  });

  it("keeps an unanchored manual outcome at a stable top boundary", () => {
    for (const hasNewerItems of [false, true]) {
      const placement = placeQuestOutcomeInFeed({ sections, sessionId: "leader", hasNewerItems });
      expect(placement.kind).toBe("before-turn");
      expect(placement.kind === "before-turn" ? placement.turnId : null).toBe("t1");
    }
  });

  it("places an exact mid-turn anchor before later activity in the same turn", () => {
    const first = turn("split", 7, "a1");
    const later = {
      kind: "message" as const,
      msg: { id: "a2", role: "assistant" as const, content: "later", timestamp: 8, historyIndex: 8 },
    };
    first.allEntries.push(later);
    first.presentationEntries = [...first.allEntries];
    const placement = placeQuestOutcomeInFeed({
      sections: [{ id: "section", turns: [first, turn("next", 12, "a3")] }],
      anchor: { sessionId: "leader", historyIndex: 7, messageId: "a1" },
      sessionId: "leader",
      hasNewerItems: false,
    });
    expect(placement).toMatchObject({ kind: "within-turn", turnId: "split", afterMessageId: "a1" });
    expect([...placement.newerTurnIds]).toEqual(["split", "next"]);
  });

  it("places a user-message anchor after the request and before later same-turn activity", () => {
    const anchored = turn("user-turn", 4, "a4");
    anchored.userEntry = {
      kind: "message",
      msg: { id: "u3", role: "user", content: "Request", timestamp: 3, historyIndex: 3 },
    };
    const placement = placeQuestOutcomeInFeed({
      sections: [{ id: "section", turns: [anchored] }],
      anchor: { sessionId: "leader", historyIndex: 3, messageId: "u3" },
      sessionId: "leader",
      hasNewerItems: false,
    });
    expect(placement).toMatchObject({ kind: "after-user", turnId: "user-turn" });
  });

  it("covers final reporting but leaves the first post-completion direct-user turn below", () => {
    const followup = turn("followup", 14, "u-followup");
    followup.userEntry = {
      kind: "message",
      msg: { id: "u-followup", role: "user", content: "Clarify", timestamp: 14, historyIndex: 14 },
    };
    const placement = placeQuestOutcomeInFeed({
      sections: [{ id: "section", turns: [turn("work", 3), turn("complete", 7), followup] }],
      sessionId: "leader",
      hasNewerItems: false,
      completedAt: 10,
    });
    expect(placement).toMatchObject({ kind: "before-turn", turnId: "followup" });
    expect([...placement.coveredTurnIds]).toEqual(["work", "complete"]);
  });

  it("lets a completed revision explicitly advance through post-completion activity", () => {
    const followup = turn("followup", 15, "a15");
    followup.userEntry = {
      kind: "message",
      msg: { id: "u14", role: "user", content: "Clarify", timestamp: 14, historyIndex: 14 },
    };
    const placement = placeQuestOutcomeInFeed({
      sections: [{ id: "section", turns: [turn("work", 3), turn("complete", 7), followup] }],
      anchor: { sessionId: "leader", historyIndex: 15, messageId: "a15" },
      sessionId: "leader",
      hasNewerItems: false,
      completedAt: 10,
    });
    expect(placement.kind).toBe("after-window");
    expect([...placement.coveredTurnIds]).toEqual(["work", "complete", "followup"]);
  });

  it("fails closed when the outcome boundary belongs to another leader session", () => {
    expect(
      placeQuestOutcomeInFeed({
        sections,
        anchor: { sessionId: "other", historyIndex: 7, messageId: "a2" },
        sessionId: "leader",
        hasNewerItems: false,
      }).kind,
    ).toBe("hidden");
  });
});
