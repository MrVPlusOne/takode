export function parseCommitShas(rawValues: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of rawValues.filter(Boolean)) {
    const sha = value.trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) {
      throw new Error(`Invalid commit SHA: ${value}`);
    }
    if (seen.has(sha)) continue;
    seen.add(sha);
    result.push(sha);
  }
  return result;
}
