import type { QuestmasterTask } from "../server/quest-types.js";

export async function runTagsCommand(deps: {
  listQuests: () => Promise<QuestmasterTask[]>;
  validateFlags: (known: string[]) => void;
  jsonOutput: boolean;
  out: (value: unknown) => void;
}): Promise<void> {
  deps.validateFlags(["json"]);
  const quests = await deps.listQuests();
  const tagCounts = new Map<string, number>();
  for (const quest of quests) {
    for (const tag of quest.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  if (deps.jsonOutput) {
    deps.out(Object.fromEntries(tagCounts));
    return;
  }

  if (tagCounts.size === 0) {
    console.log("No tags found.");
    return;
  }
  const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [tag, count] of sorted) {
    console.log(`  ${tag} (${count})`);
  }
}
