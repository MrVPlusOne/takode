// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("renders follow-up and backlink quests as reusable hover-preview quest links", () => {
    // Related quests should use QuestInlineLink anchors so hover previews and Questmaster navigation stay consistent.
    const earlier = quest({ questId: "q-1", title: "Original" });
    const followUp = quest({
      questId: "q-2",
      title: "Follow-up",
      relatedQuests: [
        { questId: "q-1", kind: "follow_up_of", explicit: true },
        { questId: "q-3", kind: "references", explicit: false },
        { questId: "q-4", kind: "has_follow_up", explicit: true },
        { questId: "q-5", kind: "referenced_by", explicit: false },
      ],
    });
    const forwardReference = quest({
      questId: "q-3",
      title: "Forward reference",
    });
    const laterFollowUp = quest({ questId: "q-4", title: "Later follow-up" });
    const backlink = quest({ questId: "q-5", title: "Backlink" });
    useStore.setState({
      quests: [earlier, followUp, forwardReference, laterFollowUp, backlink],
    });

    render(<QuestRelationshipLinks quest={followUp} />);

    // Several related quests collapse into one counted chip; the list opens only when expanded.
    const chip = screen.getByRole("button", {
      name: "Expand related quests, 3",
    });
    expect(chip.textContent).toBe("3 related quests");
    expect(screen.queryByTestId("quest-relationships")).toBeNull();
    fireEvent.click(chip);

    const relationships = screen.getByTestId("quest-relationships");
    expect(screen.getByRole("button", { name: "Collapse related quests, 3" })).toBeTruthy();
    expect(within(relationships).getByText("Follow-up of")).toBeTruthy();
    expect(within(relationships).getByText("Has follow-up")).toBeTruthy();
    expect(within(relationships).getByText("Referenced by")).toBeTruthy();
    expect(within(relationships).getByText("q-1").closest("a")?.getAttribute("href")).toContain("quest=q-1");
    expect(within(relationships).getByText("q-4").closest("a")?.getAttribute("href")).toContain("quest=q-4");
    expect(within(relationships).getByText("q-5").closest("a")?.getAttribute("href")).toContain("quest=q-5");
    expect(within(relationships).queryByText("References")).toBeNull();
    expect(within(relationships).queryByText("q-3")).toBeNull();
    expect(within(relationships).queryByRole("button", { name: /Preview q-/ })).toBeNull();
  });

  it("names the relationship kind on the chip when all related quests share it", () => {
    const quests = [5, 6, 7, 8].map((n) => quest({ questId: `q-${n}`, title: `Backlink ${n}` }));
    const target = quest({
      questId: "q-2",
      title: "Target",
      relatedQuests: quests.map((q) => ({
        questId: q.questId,
        kind: "referenced_by" as const,
        explicit: false,
      })),
    });
    useStore.setState({ quests: [target, ...quests] });

    render(<QuestRelationshipLinks quest={target} />);

    expect(screen.getByRole("button", { name: "Expand related quests, 4" }).textContent).toBe("Referenced by 4");
  });

  it("shows a single related quest directly without a toggle", () => {
    const earlier = quest({ questId: "q-1", title: "Original" });
    const followUp = quest({
      questId: "q-2",
      title: "Follow-up",
      relatedQuests: [
        { questId: "q-1", kind: "follow_up_of", explicit: true },
        // Forward detected references are not shown, so they do not count toward the chip.
        { questId: "q-3", kind: "references", explicit: false },
      ],
    });
    useStore.setState({ quests: [earlier, followUp] });

    render(<QuestRelationshipLinks quest={followUp} />);

    const relationships = screen.getByTestId("quest-relationships");
    expect(relationships.textContent).toBe("Follow-up ofq-1");
    expect(within(relationships).getByText("q-1").closest("a")?.getAttribute("href")).toContain("quest=q-1");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides forward detected references in inline Questmaster placements", () => {
    const followUp = quest({
      questId: "q-2",
      title: "Follow-up",
      relatedQuests: [
        { questId: "q-3", kind: "references", explicit: false },
        { questId: "q-5", kind: "referenced_by", explicit: false },
      ],
    });
    const forwardReference = quest({
      questId: "q-3",
      title: "Forward reference",
    });
    const backlink = quest({ questId: "q-5", title: "Backlink" });
    useStore.setState({ quests: [followUp, forwardReference, backlink] });

    const { container } = render(<QuestRelationshipLinks quest={followUp} variant="inline" />);

    expect(screen.getByText("Referenced by")).toBeTruthy();
    expect(screen.getByText("q-5").closest("a")?.getAttribute("href")).toContain("quest=q-5");
    expect(screen.queryByText("References")).toBeNull();
    expect(screen.queryByText("q-3")).toBeNull();
    expect(container.textContent).not.toContain("References");
  });
});
