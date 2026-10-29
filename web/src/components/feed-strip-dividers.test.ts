import { describe, expect, it } from "vitest";
import type { StartedQuest } from "../api/started-quests.js";
import type { ChatMessage } from "../types.js";
import { dividersAboveStrips } from "./feed-strip-dividers.js";
import { mainQuestStrips } from "./MainQuestStrip.js";

/**
 * Quest strips in topic conversations and Main. Jiayi chose Main strips (the topic view's design) to
 * name the quest each request went to, and asked that a day/time divider never sit between a strip
 * and the first message under it: the divider comes first, then the strip, then the message.
 */
function user(id: string, timestamp = 1, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: "user",
    content: id,
    timestamp,
    metadata: { leaderResponseCoverageVersion: 1, threadKey: "main" },
    ...extra,
  } as ChatMessage;
}

function turn(message: ChatMessage, ...rest: ChatMessage[]) {
  return {
    userEntry: { kind: "message" as const, msg: message },
    allEntries: rest.map((msg) => ({ kind: "message" as const, msg })),
  };
}

function quest(questId: string, messageId: string, sideQuest = false): StartedQuest {
  return {
    questId,
    title: `Title ${questId}`,
    sideQuest,
    startedFrom: { sessionId: "leader", messageId, threadKey: "main", timestamp: 1 },
  };
}

describe("dividers above strips", () => {
  it("moves the divider at a strip's first message above the strip, and keeps later ones", () => {
    const turns = [turn(user("u1", 10)), turn(user("u2", 20), user("a2", 30)), turn(user("u3", 40))];
    const labels = new Map([
      ["u1", "Mon"],
      ["u2", "Tue"],
      ["a2", "3:00 PM"],
      ["u3", "Wed"],
    ]);
    const { entryBoundaryLabels, dividerAboveStrip } = dividersAboveStrips(
      turns,
      (index) => index === 1, // only the second turn has a strip
      ["u1", "u2", "u3"],
      labels,
    );
    // Above the strip: Tuesday's divider. Inside the run, the later 3:00 PM divider stays.
    expect([...dividerAboveStrip]).toEqual([[1, { timestamp: 20, label: "Tue" }]]);
    expect([...entryBoundaryLabels.keys()]).toEqual(["u1", "a2", "u3"]);
  });

  it("changes nothing for a strip whose first message has no divider", () => {
    const result = dividersAboveStrips([turn(user("u1"))], () => true, ["u1"], new Map());
    expect(result.dividerAboveStrip.size).toBe(0);
  });
});

describe("strips in Main", () => {
  it("puts a strip above each request that moved to another quest, and Main where Main resumes", () => {
    const handedOff = user("u1", 1, {
      metadata: {
        leaderResponseCoverageVersion: 1,
        threadKey: "main",
        threadRefs: [{ threadKey: "q-44", questId: "q-44", source: "explicit" }],
      },
    });
    const started = new Map([
      ["u1", [quest("q-44", "u1")]],
      ["u2", [quest("q-44", "u2")]],
      ["u4", [quest("q-50", "u4", true)]], // a side quest: the request stays in Main
    ]);
    const turns = [turn(handedOff), turn(user("u2")), turn(user("u3")), turn(user("u4"))];
    expect(mainQuestStrips(turns, started).map((strip) => (strip ? (strip.quest?.questId ?? "main") : null))).toEqual([
      "q-44",
      null,
      "main",
      null,
    ]);
  });

  it("starts no strip for worker events or timers", () => {
    const herd = user("h1", 1, { agentSource: { sessionId: "herd-events" } });
    expect(mainQuestStrips([turn(herd)], new Map([["h1", [quest("q-1", "h1")]]]))).toEqual([null]);
  });
});
