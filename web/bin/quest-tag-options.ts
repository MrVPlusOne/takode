export function parseCommaSeparatedTags(value: string | undefined): string[] | undefined {
  return value
    ? value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : undefined;
}
