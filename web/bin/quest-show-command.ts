import type { QuestmasterTask } from "../server/quest-types.js";
import { formatQuestDetail, type SessionMetadata } from "./quest-format.js";

type QuestShowCommandDeps = {
  validateFlags: (allowed: string[]) => void;
  positional: (index: number) => string | undefined;
  flag: (name: string) => boolean;
  option: (name: string) => string | undefined;
  getQuest: (id: string) => Promise<QuestmasterTask | null>;
  getSessionMetadataMap: () => Promise<Map<string, SessionMetadata>>;
  currentSessionId?: string;
  getSessionName: (sessionId: string) => string | undefined;
  jsonOutput: boolean;
  out: (data: unknown) => void;
  die: (message: string) => never;
  printHumanFeedbackWarning: (quest: QuestmasterTask) => void;
};

export async function runShowCommand(deps: QuestShowCommandDeps): Promise<void> {
  deps.validateFlags(["json", "sections", "full"]);
  const id = deps.positional(0);
  if (!id || (deps.flag("sections") && !deps.option("sections"))) {
    deps.die("Usage: quest show <questId> [--sections <list>] [--full] [--json]");
  }

  const quest = await deps.getQuest(id);
  if (!quest) deps.die(`Quest ${id} not found`);

  if (deps.jsonOutput) {
    deps.out(quest);
    return;
  }

  const sessionMetadata = await deps.getSessionMetadataMap();
  console.log(
    formatQuestDetail(quest, sessionMetadata, {
      currentSessionId: deps.currentSessionId,
      getSessionName: deps.getSessionName,
      full: deps.flag("full"),
      sections: deps.option("sections"),
    }),
  );
  deps.printHumanFeedbackWarning(quest);
}
