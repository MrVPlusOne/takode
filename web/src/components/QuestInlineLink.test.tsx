// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { QuestmasterTask } from "../types.js";
import { useStore } from "../store.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

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

describe("QuestInlineLink", () => {
  beforeEach(() => {
    useStore.getState().reset();
    window.location.hash = "#/session/s1";
  });

  it("keeps hover metadata lookup working with many quest links", () => {
    useStore.setState({
      quests: Array.from({ length: 300 }, (_, index) =>
        quest({ questId: `q-${index + 1}`, title: `Quest ${index + 1}` }),
      ),
    });

    render(<QuestInlineLink questId="q-240" />);
    fireEvent.mouseEnter(screen.getByText("q-240"));

    expect(screen.getByTestId("quest-hover-title").textContent).toBe("Quest 240");
  });
});
