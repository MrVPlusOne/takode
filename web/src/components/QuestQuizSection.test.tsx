// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QuestQuizSection } from "./QuestQuizSection.js";

describe("QuestQuizSection", () => {
  it("renders compact quiz prompts with answers collapsed until reveal", () => {
    // Protects the active-recall interaction: prompt first, answer only after explicit reveal.
    const { container } = render(
      <QuestQuizSection
        variant="compact"
        items={[
          {
            id: "one",
            question: "What should be remembered?",
            answer: "The key design decision.",
            source: "Memory",
          },
          {
            id: "two",
            question: "What should be avoided?",
            answer: "Generic trivia.",
          },
          {
            id: "three",
            question: "Where is the long form?",
            answer: "Quest details.",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("quest-quiz-compact")).toHaveTextContent("Quiz");
    expect(screen.getAllByTestId("quest-quiz-item")).toHaveLength(2);
    expect(screen.getByText("+1 more in quest details")).toBeInTheDocument();

    const firstDetails = container.querySelector("details") as HTMLDetailsElement | null;
    expect(firstDetails).toBeTruthy();
    expect(firstDetails?.open).toBe(false);

    fireEvent.click(screen.getAllByText("Show answer")[0]!);
    expect(firstDetails?.open).toBe(true);
  });
});
