// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { MarkdownContent } from "../components/MarkdownContent.js";
import {
  ADDITIONAL_COMMENTS_KEY,
  formatNeedsInputResponse,
  type NeedsInputQuestionView,
} from "./notification-questions.js";

function question(key: string, prompt: string): NeedsInputQuestionView {
  return { key, prompt, suggestedAnswers: [] };
}

describe("formatNeedsInputResponse", () => {
  it("keeps the single-question reply shape", () => {
    expect(
      formatNeedsInputResponse("Deploy?", [question("q-0", "Deploy now?")], {
        "q-0": " yes ",
      }),
    ).toBe("Deploy now?\n\nAnswer: yes");
  });

  it("numbers each question once when the prompts already carry their own numbers", () => {
    // Leaders often write prompts like "1. Who ...?"; the reply list must not read "1. 1. Who ...?".
    const content = formatNeedsInputResponse(
      "Repo choices",
      [
        question("q-0", "1. Who creates the repo?"),
        question("q-1", "2) Which skills move?"),
        question("q-2", "(3) Who approves?"),
      ],
      { "q-0": "Worker", "q-1": "Only check-slack", "q-2": "Me" },
    );
    expect(content).toBe(
      [
        "Answers for: Repo choices",
        "",
        "1. Who creates the repo?",
        "   Answer: Worker",
        "",
        "2. Which skills move?",
        "   Answer: Only check-slack",
        "",
        "3. Who approves?",
        "   Answer: Me",
      ].join("\n"),
    );
  });

  it("leaves numbers that are part of the question text alone", () => {
    const content = formatNeedsInputResponse(
      undefined,
      [question("q-0", "3.5 GB enough?"), question("q-1", "2026 rollout or later?")],
      { "q-0": "yes", "q-1": "later" },
    );
    expect(content).toContain("1. 3.5 GB enough?");
    expect(content).toContain("2. 2026 rollout or later?");
  });

  it("indents every line of a multi-line answer under its question", () => {
    // Without the indent, a paragraph after a blank line leaves the list item, so it reads
    // as a separate message instead of part of the answer (both as raw text and rendered).
    const answers: Record<string, string> = {};
    const questions = Array.from({ length: 10 }, (_, index) => {
      answers[`q-${index}`] = "ok";
      return question(`q-${index}`, `${index + 1}. Question ${index + 1}?`);
    });
    answers["q-9"] = "Could you explain more?\n\nHow would this work for someone else?\n  - an indented list";
    const content = formatNeedsInputResponse("Choices", questions, answers);

    // Two-digit markers need a four-space indent to keep the continuation in the item.
    expect(
      content.endsWith(
        [
          "10. Question 10?",
          "    Answer: Could you explain more?",
          "",
          "    How would this work for someone else?",
          "      - an indented list",
        ].join("\n"),
      ),
    ).toBe(true);

    const { container } = render(<MarkdownContent text={content} />);
    const items = container.querySelectorAll("ol > li");
    expect(items).toHaveLength(10);
    expect(items[9]?.textContent).toContain("How would this work for someone else?");
    expect(container.querySelector("ol ol")).toBeNull();
  });

  it("adds additional comments after the answers, outside the numbered list", () => {
    // The asker must see comments beyond the questions as their own section, not as part of the last answer.
    const content = formatNeedsInputResponse("Choices", [question("q-0", "Which?"), question("q-1", "When?")], {
      "q-0": "A",
      "q-1": "now",
      [ADDITIONAL_COMMENTS_KEY]: " Also check the docs.\n\nThanks ",
    });
    expect(content.endsWith("2. When?\n   Answer: now\n\nAdditional comments:\nAlso check the docs.\n\nThanks")).toBe(
      true,
    );

    const { container } = render(<MarkdownContent text={content} />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelector("ol")?.textContent).not.toContain("Additional comments");
  });

  it("leaves the reply unchanged when the additional comments are blank", () => {
    expect(
      formatNeedsInputResponse("Deploy?", [question("q-0", "Deploy now?")], {
        "q-0": "yes",
        [ADDITIONAL_COMMENTS_KEY]: "  ",
      }),
    ).toBe("Deploy now?\n\nAnswer: yes");
  });
});
