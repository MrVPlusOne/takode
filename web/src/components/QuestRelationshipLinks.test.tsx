// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import type { QuestmasterTask } from "../types.js";
import { useStore } from "../store.js";
import { QuestRelationshipLinks } from "./QuestRelationshipLinks.js";

function quest(overrides: Partial<QuestmasterTask> & { questId: string; title: string }): QuestmasterTask {
  const { questId, title, ...rest } = overrides;
  return {
    id: questId,
    questId,
    version: 1,
    status: "idea",
    title,
    createdAt: 1,
    ...rest,
  } as QuestmasterTask;
}

describe("QuestRelationshipLinks", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("renders related quests as reusable hover-preview quest links", () => {
    // Related quests should use QuestInlineLink anchors so hover previews and Questmaster navigation stay consistent.
    const earlier = quest({ questId: "q-1", title: "Original" });
    const followUp = quest({
      questId: "q-2",
      title: "Follow-up",
      relatedQuests: [
        { questId: "q-1", kind: "follow_up_of", explicit: true },
        { questId: "q-3", kind: "references", explicit: false },
      ],
    });
    const referenced = quest({ questId: "q-3", title: "Referenced context" });
    useStore.setState({ quests: [earlier, followUp, referenced] });

    render(<QuestRelationshipLinks quest={followUp} />);

    const relationships = screen.getByTestId("quest-relationships");
    expect(within(relationships).getByText("Related Quests")).toBeTruthy();
    expect(within(relationships).getByText("Follow-up of")).toBeTruthy();
    expect(within(relationships).getByText("References")).toBeTruthy();
    expect(within(relationships).getByText("detected")).toBeTruthy();
    expect(within(relationships).getByText("q-1").closest("a")?.getAttribute("href")).toContain("quest=q-1");
    expect(within(relationships).getByText("q-3").closest("a")?.getAttribute("href")).toContain("quest=q-3");
  });
});
