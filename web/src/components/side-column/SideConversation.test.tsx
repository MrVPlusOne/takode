// @vitest-environment jsdom
/**
 * A conversation in the side column reads like the main view: a request there that moved into a
 * quest says where it continues, so its feed gets the leader's started quests as the main feed does.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartedQuestsContext } from "../QuestForkLinks.js";

vi.mock("../MessageFeed.js", () => ({
  MessageFeed: () => {
    const started = useContext(StartedQuestsContext);
    return (
      <div data-testid="feed">
        {started
          ?.get("side-ask")
          ?.map((quest) => quest.questId)
          .join(",") ?? "none"}
      </div>
    );
  },
}));
vi.mock("../Composer.js", () => ({ Composer: () => null }));
vi.mock("../../hooks/use-unread-messages-seen.js", () => ({ useUnreadMessagesSeen: () => {} }));
vi.mock("../../utils/leader-topics.js", () => ({ useKnownThreadOfKey: () => null }));
vi.mock("../library/TopicConversation.js", () => ({ useStandaloneTopicConversation: () => null }));

import { SideConversation } from "./SideConversation.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SideConversation", () => {
  it("gives its feed the quests the leader's requests continue in", async () => {
    const startedFrom = { sessionId: "leader", messageId: "side-ask", threadKey: "topic:aaaa0001", timestamp: 1 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ quests: [{ questId: "q-9", title: "Slides", startedFrom, sideQuest: false }] }),
      ),
    );
    render(<SideConversation leaderId="leader" threadKey="topic:aaaa0001" />);
    expect(await screen.findByText("q-9")).toBeTruthy();
  });
});
