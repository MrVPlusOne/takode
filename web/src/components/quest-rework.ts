export function buildQuestReworkDraft(questId: string): string {
  return `Please address the unaddressed human feedback on ${questId}. Run /quest show ${questId}, then implement the requested fixes and report back.`;
}
