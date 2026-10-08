export async function runTagsCommand(deps: {
  /** Number of quests carrying each tag. */
  tagCounts: () => Promise<Record<string, number>>;
  validateFlags: (known: string[]) => void;
  jsonOutput: boolean;
  out: (value: unknown) => void;
}): Promise<void> {
  deps.validateFlags(["json"]);
  const counts = await deps.tagCounts();
  const tagCounts = new Map(Object.entries(counts));

  if (deps.jsonOutput) {
    deps.out(counts);
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
