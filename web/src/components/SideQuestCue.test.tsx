// @vitest-environment jsdom
/**
 * Side quests are marked in a leader's quest header from the leader's tab projection:
 * the server sets `sideQuestOf` on the tab, and the header shows the branch icon.
 */
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { QuestThreadBanner } from "./QuestThreadBanner.js";
import { useSideQuestOf } from "./SideQuestCue.js";

/** The header as ChatView wires it for the leader's selected quest tab. */
function LeaderQuestHeader({ questId }: { questId: string }) {
  const sideQuestOf = useSideQuestOf("leader", questId);
  return (
    <QuestThreadBanner
      row={{ threadKey: questId, title: "Baseline evals" }}
      threadKey={questId}
      sideQuestOf={sideQuestOf}
    />
  );
}

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: "leader",
      value: createLeaderThreadTabsProjectionValue({
        tabs: [
          // q-12 was filed from a request asked in q-7, which is still answered there.
          createLeaderThreadTabsProjectionTab("q-12", { sideQuestOf: "q-7" }),
          createLeaderThreadTabsProjectionTab("q-13"),
        ],
      }),
    }),
  );
});
afterEach(cleanup);

describe("side quest mark in the quest header", () => {
  it("shows the branch icon, naming the thread the answer goes to, for a side quest", () => {
    // The route's quest ID can differ in case from the projection's thread key.
    render(<LeaderQuestHeader questId="Q-12" />);
    expect(screen.getByRole("img", { name: "Side quest of q-7" })).toBeInTheDocument();
  });

  it("shows nothing for an ordinary quest", () => {
    render(<LeaderQuestHeader questId="q-13" />);
    expect(screen.queryByTestId("side-quest-icon")).not.toBeInTheDocument();
  });
});
