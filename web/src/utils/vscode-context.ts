export interface VsCodeSelectionContext {
  label: string;
  messageSuffix: string;
  updatedAt: number;
}

export interface VsCodeSelectionContextPayload {
  label: string;
  messageSuffix: string;
}

export const VSCODE_CONTEXT_SOURCE = "takode-vscode-prototype";
export const VSCODE_CONTEXT_MESSAGE_TYPE = "takode:vscode-context";
export const VSCODE_READY_MESSAGE_TYPE = "takode:vscode-ready";

export function isVsCodeSelectionContextPayload(value: unknown): value is VsCodeSelectionContextPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.label === "string" && typeof record.messageSuffix === "string";
}

export function appendVsCodeContext(content: string, context: VsCodeSelectionContext | null, enabled: boolean): string {
  if (!enabled || !context?.messageSuffix) return content;
  return `${content}\n\n${context.messageSuffix}`;
}

export function maybeReadVsCodeSelectionContext(
  value: unknown,
): VsCodeSelectionContextPayload | null | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.source !== VSCODE_CONTEXT_SOURCE || record.type !== VSCODE_CONTEXT_MESSAGE_TYPE) {
    return undefined;
  }
  if (record.payload === null) {
    return null;
  }
  return isVsCodeSelectionContextPayload(record.payload) ? record.payload : undefined;
}

export function announceVsCodeReady(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.parent?.postMessage(
      {
        source: VSCODE_CONTEXT_SOURCE,
        type: VSCODE_READY_MESSAGE_TYPE,
      },
      "*",
    );
  } catch {
    // Ignore cross-origin/window access issues. The browser-only app works without this bridge.
  }
}
