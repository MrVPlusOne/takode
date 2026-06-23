import type { QuestQuizItem } from "./quest-types.js";

function normalizeQuizItemId(value: unknown, index: number): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw) return raw;
  return `quiz-${index + 1}`;
}

export function normalizeQuestQuizItems(value: unknown): QuestQuizItem[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("quizItems must be an array");
  }

  const items: QuestQuizItem[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`quizItems[${index}] must be an object`);
    }
    const item = raw as Record<string, unknown>;
    const question = typeof item.question === "string" ? item.question.trim() : "";
    const answer = typeof item.answer === "string" ? item.answer.trim() : "";
    if (!question) throw new Error(`quizItems[${index}].question is required`);
    if (!answer) throw new Error(`quizItems[${index}].answer is required`);
    const source = typeof item.source === "string" ? item.source.trim() : "";
    items.push({
      id: normalizeQuizItemId(item.id, index),
      question,
      answer,
      ...(source ? { source } : {}),
    });
  }

  return items.length > 0 ? items : undefined;
}
