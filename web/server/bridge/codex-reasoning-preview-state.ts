import { normalizeThreadTarget } from "../../shared/thread-routing.js";
import type { ActiveCodexReasoningPreview, ActiveTurnRoute } from "../session-types.js";

export type CodexReasoningPreviewsByThread = Record<string, ActiveCodexReasoningPreview>;

export interface CodexReasoningPreviewSession {
  activeCodexReasoningPreview?: ActiveCodexReasoningPreview | null;
  codexReasoningPreviews?: CodexReasoningPreviewsByThread;
}

export function codexReasoningThreadKey(
  route: { threadKey?: string; questId?: string } | null | undefined,
): string | null {
  const target = normalizeThreadTarget(route?.threadKey ?? route?.questId ?? "");
  return target?.threadKey ?? null;
}

export function listCodexReasoningPreviews(session: CodexReasoningPreviewSession): ActiveCodexReasoningPreview[] {
  return Object.values(session.codexReasoningPreviews ?? {}).sort((left, right) => left.updatedAt - right.updatedAt);
}

export function codexReasoningSnapshotFields(session: CodexReasoningPreviewSession | null | undefined) {
  return { codexReasoningPreviews: session ? listCodexReasoningPreviews(session) : [] };
}

export function retainCodexReasoningPreview(
  session: CodexReasoningPreviewSession,
  preview: ActiveCodexReasoningPreview,
): boolean {
  const threadKey = codexReasoningThreadKey(preview);
  if (!threadKey || !preview.text.trim()) return false;
  session.codexReasoningPreviews = {
    ...(session.codexReasoningPreviews ?? {}),
    [threadKey]: preview,
  };
  return true;
}

export function clearCodexReasoningPreviewForRoute(
  session: CodexReasoningPreviewSession,
  route: Pick<ActiveTurnRoute, "threadKey" | "questId"> | null | undefined,
): boolean {
  const threadKey = codexReasoningThreadKey(route);
  if (!threadKey) return false;

  let changed = false;
  if (session.codexReasoningPreviews?.[threadKey]) {
    const next = { ...session.codexReasoningPreviews };
    delete next[threadKey];
    session.codexReasoningPreviews = Object.keys(next).length > 0 ? next : undefined;
    changed = true;
  }
  if (codexReasoningThreadKey(session.activeCodexReasoningPreview) === threadKey) {
    session.activeCodexReasoningPreview = null;
    changed = true;
  }
  return changed;
}
