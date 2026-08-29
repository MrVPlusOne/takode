interface ToolRelationOwner {
  codexSubagent?: { childId: string } | null;
}

/** Tool IDs are provider-local; pair them with native-child ownership before matching results. */
export function toolRelationKey(owner: ToolRelationOwner, toolUseId: string): string {
  return JSON.stringify([owner.codexSubagent?.childId ?? null, toolUseId]);
}
