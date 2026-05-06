import type { SessionNotification } from "../types.js";

export interface NeedsInputQuestionView {
  key: string;
  prompt: string;
  suggestedAnswers: string[];
}

export function getNeedsInputQuestionViews(notif: SessionNotification): NeedsInputQuestionView[] {
  if (notif.category !== "needs-input") return [];
  if (notif.questions?.length) {
    return notif.questions.map((question, index) => ({
      key: `q-${index}`,
      prompt: question.prompt,
      suggestedAnswers: question.suggestedAnswers ?? [],
    }));
  }
  return [
    {
      key: "legacy",
      prompt: notif.summary || "Your response",
      suggestedAnswers: notif.suggestedAnswers ?? [],
    },
  ];
}

export function formatNeedsInputResponse(
  summary: string | undefined,
  questions: NeedsInputQuestionView[],
  answers: Record<string, string>,
): string {
  const answered = questions.map((question) => ({
    prompt: question.prompt,
    answer: answers[question.key]?.trim() ?? "",
  }));
  if (answered.length === 1) {
    return `${answered[0].prompt}\n\nAnswer: ${answered[0].answer}`;
  }

  const lines = summary?.trim() ? [`Answers for: ${summary.trim()}`, ""] : ["Needs-input answers:", ""];
  answered.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.prompt}`);
    lines.push(`Answer: ${item.answer}`);
    if (index < answered.length - 1) lines.push("");
  });
  return lines.join("\n");
}
