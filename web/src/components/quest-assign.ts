export function buildQuestAssignDraft(questId: string): string {
  return `Please run /quest claim ${questId}, then immediately start working on this quest.`;
}
