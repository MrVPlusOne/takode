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
    expect(screen.getByText("Source: Memory")).not.toBeVisible();

    const firstDetails = container.querySelector("details") as HTMLDetailsElement | null;
    expect(firstDetails).toBeTruthy();
    expect(firstDetails?.open).toBe(false);

    fireEvent.click(screen.getAllByText("Show answer")[0]!);
    expect(firstDetails?.open).toBe(true);
    expect(screen.getByText("Source: Memory")).toBeVisible();
    expect(screen.getByText("The key design decision.").closest(".markdown-body")).toHaveClass("text-xs");
  });

  it("can collapse the whole quest-detail quiz section before individual answer reveals", () => {
    // Keeps the direct quest UI scannable: users opt into the quiz, then each answer.
    const { container } = render(
      <QuestQuizSection
        collapsed
        items={[
          {
            id: "one",
            question: "Which decision matters?",
            answer: "The quiz belongs in quest metadata.",
          },
        ]}
      />,
    );

    const sectionDetails = screen.getByTestId("quest-quiz-section") as HTMLDetailsElement;
    expect(sectionDetails.open).toBe(false);
    expect(screen.getByText("1 item")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Quiz"));
    expect(sectionDetails.open).toBe(true);

    const answerDetails = container.querySelectorAll("details")[1] as HTMLDetailsElement | undefined;
    expect(answerDetails?.open).toBe(false);
    fireEvent.click(screen.getByText("Show answer"));
    expect(answerDetails?.open).toBe(true);
    expect(screen.getByText("The quiz belongs in quest metadata.").closest(".markdown-body")).toHaveClass(
      "text-[13px]",
      "sm:text-[14px]",
    );
  });

  it("renders an inline completion quiz without surfacing source labels before reveal", () => {
    const { container } = render(
      <QuestQuizSection
        variant="inline"
        questId="q-8"
        questTitle="Add Quest Quiz Metadata"
        items={[
          {
            id: "one",
            question: "Why show this quiz inline?",
            answer: "The completion moment is when recall is useful.",
            source: "completion summary",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("quest-quiz-inline")).toHaveTextContent("q-8");
    expect(screen.getByText("Add Quest Quiz Metadata")).toBeInTheDocument();
    expect(screen.getByText("Source: completion summary")).not.toBeVisible();

    const answerDetails = container.querySelector("details") as HTMLDetailsElement | null;
    expect(answerDetails?.open).toBe(false);
    fireEvent.click(screen.getByText("Show answer"));
    expect(screen.getByText("The completion moment is when recall is useful.").closest(".markdown-body")).toHaveClass(
      "text-[13px]",
      "sm:text-[14px]",
    );
    expect(screen.getByText("Source: completion summary")).toBeVisible();
  });
});
