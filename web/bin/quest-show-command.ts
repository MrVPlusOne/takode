import type { QuestmasterTask } from "../server/quest-types.js";
import type { TodoCompactItem } from "../shared/todo-types.js";
import { formatQuestDetail, type SessionMetadata } from "./quest-format.js";
import { buildQuestRounds } from "../shared/quest-rounds.js";

type QuestShowCommandDeps = {
  validateFlags: (allowed: string[]) => void;
  positional: (index: number) => string | undefined;
  flag: (name: string) => boolean;
  option: (name: string) => string | undefined;
  getQuest: (id: string) => Promise<QuestmasterTask | null>;
  getSessionMetadataMap: (shown: QuestmasterTask) => Promise<Map<string, SessionMetadata>>;
  /** Personal to-dos linking this quest; null when no server can answer. */
  getLinkedTodos: (questId: string) => Promise<{ items: TodoCompactItem[] } | { error: string } | null>;
  currentSessionId?: string;
  getSessionName: (sessionId: string) => string | undefined;
  jsonOutput: boolean;
  out: (data: unknown) => void;
  die: (message: string) => never;
  printHumanFeedbackWarning: (quest: QuestmasterTask) => void;
};

export async function runShowCommand(deps: QuestShowCommandDeps): Promise<void> {
  deps.validateFlags(["json", "sections", "full", "round"]);
  const id = deps.positional(0);
  const round = deps.option("round");
  if (
    !id ||
    (deps.flag("sections") && !deps.option("sections")) ||
    (deps.flag("round") && !/^\d+$/.test(round ?? ""))
  ) {
    deps.die("Usage: quest show <questId> [--sections <list>] [--round <n>] [--full] [--json]");
  }

  const quest = await deps.getQuest(id);
  if (!quest) deps.die(`Quest ${id} not found`);

  if (deps.jsonOutput) {
    deps.out(round ? (buildQuestRounds(quest).rounds[Number(round) - 1] ?? null) : quest);
    return;
  }

  const sessionMetadata = await deps.getSessionMetadataMap(quest);
  console.log(
    formatQuestDetail(quest, sessionMetadata, {
      currentSessionId: deps.currentSessionId,
      getSessionName: deps.getSessionName,
      full: deps.flag("full"),
      sections: deps.option("sections"),
      ...(round ? { round: Number(round) } : {}),
    }),
  );
  const linkedTodos = await deps.getLinkedTodos(quest.questId);
  if (linkedTodos && "error" in linkedTodos) {
    console.log(`Linked to-dos: unavailable (${linkedTodos.error})`);
  } else if (linkedTodos?.items.length) {
    console.log("Linked to-dos:");
    for (const item of linkedTodos.items) {
      console.log(`  ${item.id} [${item.status}${item.archivedAt ? " archived" : ""}] ${item.titleMarkdown}`);
    }
  }
  deps.printHumanFeedbackWarning(quest);
}

/**
 * Read the personal to-dos that link a quest. A to-do route that answers with
 * an error yields that error so the output can say the list is unavailable; no
 * reachable server or route yields null, like other best-effort labels.
 */
export async function fetchLinkedTodos(
  companionPort: string | undefined,
  headers: Record<string, string>,
  questId: string,
): Promise<{ items: TodoCompactItem[] } | { error: string } | null> {
  if (!companionPort) return null;
  let response: Response;
  try {
    response = await fetch(`http://localhost:${companionPort}/api/todos/find?quest=${encodeURIComponent(questId)}`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
  const body = (await response.json().catch(() => null)) as { items?: TodoCompactItem[]; error?: string } | null;
  // A non-JSON reply is not from the to-do route (for example a server without it), so there is nothing to show.
  if (!body) return null;
  if (response.ok && Array.isArray(body.items)) return { items: body.items };
  return { error: body.error || `HTTP ${response.status}` };
}
