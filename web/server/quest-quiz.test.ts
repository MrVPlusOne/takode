import { normalizeQuestQuizItems } from "./quest-quiz.js";

describe("normalizeQuestQuizItems", () => {
  it("trims quiz Q/A metadata and assigns stable fallback ids", () => {
    // Validates the stored quest metadata shape agents can write through the CLI/API.
    expect(
      normalizeQuestQuizItems([
        {
          question: "  What should be remembered?  ",
          answer: "  The accepted tradeoff.  ",
          source: "  Memory phase  ",
        },
      ]),
    ).toEqual([
      {
        id: "quiz-1",
        question: "What should be remembered?",
        answer: "The accepted tradeoff.",
        source: "Memory phase",
      },
    ]);
  });

  it("rejects missing required active-recall fields", () => {
    // Keeps malformed quiz metadata from silently rendering empty prompts or answers.
    expect(() => normalizeQuestQuizItems([{ question: "Only a question" }])).toThrow("quizItems[0].answer is required");
  });
});
