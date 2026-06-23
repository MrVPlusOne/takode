import type { QuestQuizItem, QuestmasterTask } from "../server/quest-types.js";
import { normalizeQuestQuizItems } from "../server/quest-quiz.js";

export interface QuestQuizCommandDeps {
  positional: (index: number) => string | undefined;
  validateFlags: (allowed: string[]) => void;
  option: (name: string) => string | undefined;
  jsonOutput: boolean;
  out: (data: unknown) => void;
  die: (message: string) => never;
  warn: (message: string) => void;
  readOptionTextFile: (pathOrDash: string, flagName: string) => Promise<string>;
  getQuest: (questId: string) => Promise<QuestmasterTask | null>;
  patchQuest: (questId: string, patch: { quizItems?: QuestQuizItem[] }) => Promise<QuestmasterTask | null>;
  notifyServer: () => Promise<void>;
  companionPort: string | undefined;
  companionAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
}

function parseQuestQuizItems(raw: string, die: (message: string) => never): QuestQuizItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    die(`Invalid quiz JSON: ${message}`);
  }
  const value =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) && "quizItems" in parsed
      ? (parsed as { quizItems?: unknown }).quizItems
      : parsed;
  return normalizeQuestQuizItems(value) ?? [];
}

function formatQuestQuizItems(questId: string, items: QuestQuizItem[]): string {
  if (items.length === 0) return `No quiz items for ${questId}.`;
  const lines = [`Quiz for ${questId} (${items.length} item${items.length === 1 ? "" : "s"}):`];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    lines.push("");
    lines.push(`${index + 1}. ${item.question}`);
    lines.push(`   Answer: ${item.answer}`);
    if (item.source) lines.push(`   Source: ${item.source}`);
  }
  return lines.join("\n");
}

async function putQuestQuiz(
  questId: string,
  quizItems: QuestQuizItem[],
  deps: QuestQuizCommandDeps,
): Promise<QuestmasterTask> {
  const port = deps.companionPort;
  if (port) {
    try {
      const res = await fetch(`http://localhost:${port}/api/quests/${encodeURIComponent(questId)}/quiz`, {
        method: "PUT",
        headers: deps.companionAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ quizItems }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        if (res.status === 404) {
          deps.warn(
            (err as { error?: string }).error || "Companion quiz route not found; falling back to local quest store.",
          );
        } else {
          deps.die((err as { error: string }).error || res.statusText);
        }
      } else {
        return (await res.json()) as QuestmasterTask;
      }
    } catch (e) {
      if (!((e as Error).name === "AbortError" || (e as Error).message?.includes("timeout"))) {
        deps.die((e as Error).message);
      }
    }
  }

  const quest = await deps.patchQuest(questId, { quizItems });
  if (!quest) deps.die(`Quest ${questId} not found`);
  await deps.notifyServer();
  return quest;
}

async function cmdQuizShow(deps: QuestQuizCommandDeps): Promise<void> {
  deps.validateFlags(["json"]);
  const id = deps.positional(1);
  if (!id) deps.die("Usage: quest quiz show <questId> [--json]");
  const quest = await deps.getQuest(id);
  if (!quest) deps.die(`Quest ${id} not found`);
  const quizItems = quest.quizItems ?? [];
  if (deps.jsonOutput) {
    deps.out({ questId: quest.questId, quizItems });
    return;
  }
  console.log(formatQuestQuizItems(quest.questId, quizItems));
}

async function cmdQuizSet(deps: QuestQuizCommandDeps): Promise<void> {
  deps.validateFlags(["items-file", "json"]);
  const id = deps.positional(1);
  if (!id) deps.die("Usage: quest quiz set <questId> --items-file <path|-> [--json]");
  const itemsPath = deps.option("items-file");
  if (!itemsPath) deps.die("--items-file is required for quest quiz set");
  const raw = await deps.readOptionTextFile(itemsPath, "--items-file");
  const quizItems = parseQuestQuizItems(raw, deps.die);
  const quest = await putQuestQuiz(id, quizItems, deps);
  if (deps.jsonOutput) {
    deps.out(quest);
  } else {
    console.log(`Updated quiz for ${quest.questId} (${quest.quizItems?.length ?? 0} item(s))`);
  }
}

async function cmdQuizClear(deps: QuestQuizCommandDeps): Promise<void> {
  deps.validateFlags(["json"]);
  const id = deps.positional(1);
  if (!id) deps.die("Usage: quest quiz clear <questId> [--json]");
  const quest = await putQuestQuiz(id, [], deps);
  if (deps.jsonOutput) {
    deps.out(quest);
  } else {
    console.log(`Cleared quiz for ${quest.questId}`);
  }
}

export async function runQuizCommand(deps: QuestQuizCommandDeps): Promise<void> {
  const subcommand = deps.positional(0);
  if (subcommand === "show") return cmdQuizShow(deps);
  if (subcommand === "set") return cmdQuizSet(deps);
  if (subcommand === "clear") return cmdQuizClear(deps);
  deps.die(
    "Usage: quest quiz show <questId> [--json] | " +
      "quest quiz set <questId> --items-file <path|-> [--json] | " +
      "quest quiz clear <questId> [--json]",
  );
}
