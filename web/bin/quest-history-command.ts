import type { QuestHistoryView, QuestmasterTask } from "../server/quest-types.js";

export interface QuestHistoryCommandDeps {
  positional: (index: number) => string | undefined;
  validateFlags: (allowed: string[]) => void;
  jsonOutput: boolean;
  out: (data: unknown) => void;
  die: (message: string) => never;
  getQuest: (questId: string) => Promise<QuestmasterTask | null>;
  getQuestHistoryView: (questId: string) => Promise<QuestHistoryView>;
  statusLabels: Record<string, string>;
  timeAgo: (ts: number) => string;
}

export async function runHistoryCommand(deps: QuestHistoryCommandDeps): Promise<void> {
  deps.validateFlags(["json"]);
  const id = deps.positional(0);
  if (!id) deps.die("Usage: quest history <questId>");

  const quest = await deps.getQuest(id);
  if (!quest) deps.die(`Quest ${id} not found`);
  const history = await deps.getQuestHistoryView(id);

  if (deps.jsonOutput) {
    deps.out(history);
    return;
  }

  if (history.mode === "legacy_backup") {
    console.log("Legacy backup history");
  } else if (history.mode === "unavailable") {
    console.log(history.message ?? "History is unavailable.");
    return;
  }

  if (history.entries.length === 0) {
    console.log(history.message ?? "No previous versions.");
    return;
  }

  for (const v of history.entries) {
    console.log(
      `v${v.version} (${deps.statusLabels[v.status] ?? v.status}) -- ${deps.timeAgo(v.createdAt)}  [${v.id}]`,
    );
  }
}
