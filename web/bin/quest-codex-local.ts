import { appendQuestFeedback, getQuest, patchQuestForOwner } from "../server/quest-store.js";
import { resolveQuestFeedbackDocumentation } from "../server/quest-phase-docs.js";
import type { QuestFeedbackEntry, QuestImage, QuestQuizItem, QuestmasterTask } from "../server/quest-types.js";
import { normalizeTldr } from "../server/quest-tldr.js";
import { getQuestDisplayOwner, sameQuestOwner } from "../shared/quest-owner.js";
import { codexQuestOwner, codexQuestProvenance, type CodexQuestInvocationContext } from "./quest-codex-invocation.js";

/** Append unscoped Codex feedback with provider-aware provenance. */
export async function addCodexQuestFeedback(args: {
  context: CodexQuestInvocationContext;
  questId: string;
  text: string;
  tldr?: string;
  kind?: string;
  images?: QuestImage[];
}): Promise<{ before: QuestmasterTask; quest: QuestmasterTask; entry: QuestFeedbackEntry }> {
  const before = await getQuest(args.questId);
  if (!before) throw new Error(`Quest ${args.questId} not found`);
  const documentation = resolveQuestFeedbackDocumentation({
    quest: before,
    request: { kind: args.kind, noPhase: true },
    boardRows: [],
  });
  if (documentation.error) throw new Error(documentation.error);
  const provenance = codexQuestProvenance(args.context);
  const entry: QuestFeedbackEntry = {
    author: "agent",
    text: args.text.trim(),
    ts: provenance.recordedAt,
    provenance,
    ...documentation.entryPatch,
    ...(normalizeTldr(args.tldr) ? { tldr: normalizeTldr(args.tldr) } : {}),
    ...(args.images?.length ? { images: args.images } : {}),
  };
  const quest = await appendQuestFeedback(args.questId, entry, { lastModifiedBy: provenance });
  if (!quest) throw new Error(`Quest ${args.questId} not found`);
  return { before, quest, entry };
}

/** Edit one feedback entry owned by the current direct Codex task. */
export async function editCodexQuestFeedback(
  context: CodexQuestInvocationContext,
  questId: string,
  index: number,
  patch: { text?: string; tldr?: string },
): Promise<QuestmasterTask | null> {
  const current = await getQuest(questId);
  if (!current) return null;
  assertCodexOwner(current, context, "edit feedback on");
  const feedback = [...(current.feedback ?? [])];
  if (index >= feedback.length) throw new Error("Index out of range");
  feedback[index] = {
    ...feedback[index]!,
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.tldr !== undefined ? { tldr: normalizeTldr(patch.tldr) } : {}),
  };
  return patchQuestForOwner(questId, codexQuestOwner(context), {
    feedback,
    lastModifiedBy: codexQuestProvenance(context),
  });
}

/** Toggle one feedback addressed flag for the current direct Codex task. */
export async function toggleCodexQuestFeedbackAddressed(
  context: CodexQuestInvocationContext,
  questId: string,
  index: number,
): Promise<QuestmasterTask | null> {
  const current = await getQuest(questId);
  if (!current) return null;
  assertCodexOwner(current, context, "address feedback on");
  const feedback = [...(current.feedback ?? [])];
  if (index >= feedback.length) throw new Error("Index out of range");
  feedback[index] = { ...feedback[index]!, addressed: !feedback[index]!.addressed };
  return patchQuestForOwner(questId, codexQuestOwner(context), {
    feedback,
    lastModifiedBy: codexQuestProvenance(context),
  });
}

/** Replace quiz metadata for the current direct Codex task. */
export async function setCodexQuestQuiz(
  context: CodexQuestInvocationContext,
  questId: string,
  quizItems: QuestQuizItem[],
): Promise<QuestmasterTask | null> {
  const current = await getQuest(questId);
  if (!current) return null;
  assertCodexOwner(current, context, "edit quiz metadata on");
  return patchQuestForOwner(questId, codexQuestOwner(context), {
    quizItems,
    lastModifiedBy: codexQuestProvenance(context),
  });
}

function assertCodexOwner(quest: QuestmasterTask, context: CodexQuestInvocationContext, action: string): void {
  const currentOwner = getQuestDisplayOwner(quest);
  const actor = codexQuestOwner(context);
  if (currentOwner && !sameQuestOwner(currentOwner, actor)) {
    throw new Error(
      `Cannot ${action} ${quest.questId}: it is owned by ${currentOwner.kind} owner ${currentOwner.sessionId}`,
    );
  }
}
