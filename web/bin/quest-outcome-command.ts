import type { QuestmasterTask } from "../server/quest-types.js";

interface QuestOutcomeCommandDeps {
  positional: (index: number) => string | undefined;
  validateFlags: (allowed: string[]) => void;
  getQuest: (questId: string) => Promise<QuestmasterTask | null>;
  jsonOutput: boolean;
  out: (value: unknown) => void;
  die: (message: string) => never;
}

function printLegacyOutcome(deps: QuestOutcomeCommandDeps, questId: string, present: boolean, outcome: unknown): void {
  if (deps.jsonOutput) {
    deps.out({ questId, legacy: true, present, outcome: present ? outcome : null });
    return;
  }
  if (!present) {
    console.log(`${questId} has no preserved legacy Quest Outcome field.`);
    return;
  }
  console.log(`${questId} preserved legacy Quest Outcome data (read-only)`);
  console.log("");
  console.log(JSON.stringify(outcome, null, 2));
}

export async function runQuestOutcomeCommand(deps: QuestOutcomeCommandDeps): Promise<void> {
  const subcommand = deps.positional(0);
  const questId = deps.positional(1);
  if (!subcommand || !questId || !["show", "set", "use"].includes(subcommand)) {
    deps.die("Usage: quest outcome show <id> [--json] (read-only legacy inspection)");
  }

  if (subcommand === "show") {
    deps.validateFlags(["json"]);
    const quest = await deps.getQuest(questId);
    if (!quest) deps.die(`Quest ${questId} not found`);
    printLegacyOutcome(deps, questId, Object.prototype.hasOwnProperty.call(quest, "outcome"), quest.outcome);
    return;
  }

  deps.die(
    `quest outcome ${subcommand} was removed because Quest Outcomes are preserved legacy data, not user-editable summaries. ` +
      `Use \`takode thread-response set --thread ${questId.toLowerCase()} --text-file <path|->\` from the owning leader session.`,
  );
}
