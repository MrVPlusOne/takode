export function shouldShowCompactGuidance(content: string): boolean {
  const normalized = content.toLowerCase();
  if (normalized.includes("prompt is too long")) return true;
  if (normalized.includes("payload too large")) return true;
  if (normalized.includes("request too large")) return true;
  if (normalized.includes("failed to parse request") && normalized.includes("payload")) return true;
  return normalized.includes("413") && (normalized.includes("payload") || normalized.includes("request"));
}
