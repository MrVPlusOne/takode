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
    const marker = `${index + 1}. `;
    // Prompts often carry their own "1." numbering; the list supplies it already.
    const prompt = item.prompt.trim().replace(LEADING_LIST_NUMBER, "");
    // Indent every later line to the marker width so multi-line prompts and
    // answers stay inside their Markdown list item and read unambiguously as text.
    const body = indentContinuation(`${prompt}\nAnswer: ${item.answer}`, " ".repeat(marker.length));
    lines.push(`${marker}${body}`);
    if (index < answered.length - 1) lines.push("");
  });
  return lines.join("\n");
}

const LEADING_LIST_NUMBER = /^\(?\d+[.)]\s+/;

function indentContinuation(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 || !line.trim() ? line.trimEnd() : `${indent}${line}`))
    .join("\n");
}
