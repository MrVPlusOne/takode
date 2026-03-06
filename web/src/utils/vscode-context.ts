export interface VsCodeSelectionContext {
  label: string;
  messageSuffix: string;
  updatedAt: number;
}

export interface VsCodeSelectionContextPayload {
  label: string;
  messageSuffix: string;
}

export function isVsCodeSelectionContextPayload(value: unknown): value is VsCodeSelectionContextPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.label === "string" && typeof record.messageSuffix === "string";
}

export function appendVsCodeContext(content: string, context: VsCodeSelectionContext | null, enabled: boolean): string {
  if (!enabled || !context?.messageSuffix) return content;
  return `${content}\n\n${context.messageSuffix}`;
}
