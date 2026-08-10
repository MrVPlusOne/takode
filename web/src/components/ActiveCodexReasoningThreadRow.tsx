import type { ActiveCodexReasoningPreview, BoardRowSessionStatus } from "../types.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { PawTrailAvatar } from "./PawTrail.js";

function activeReasoningMatchesThread(
  preview: Pick<ActiveCodexReasoningPreview, "threadKey" | "questId"> | null | undefined,
  currentThreadKey: string,
): boolean {
  const current = normalizeThreadKey(currentThreadKey || "main");
  if (!preview || current === "all") return false;
  const previewThread = preview.threadKey ? normalizeThreadKey(preview.threadKey) : null;
  if (previewThread && previewThread !== current) return false;
  if (!previewThread && preview.questId && normalizeThreadKey(preview.questId) !== current) return false;
  return !!previewThread || !!preview.questId;
}

function latestProjectedWorkerReasoningPreview(
  currentThreadKey: string,
  rowStatuses: Record<string, BoardRowSessionStatus> | undefined,
): ActiveCodexReasoningPreview | null {
  let latest: ActiveCodexReasoningPreview | null = null;
  for (const status of Object.values(rowStatuses ?? {})) {
    const worker = status?.worker;
    if (!worker || worker.status === "archived") continue;
    const previews = worker.codexReasoningPreviews?.length
      ? worker.codexReasoningPreviews
      : worker.activeCodexReasoningPreview
        ? [worker.activeCodexReasoningPreview]
        : [];
    for (const preview of previews) {
      if (!preview.text?.trim() || !activeReasoningMatchesThread(preview, currentThreadKey)) continue;
      if (!latest || preview.updatedAt > latest.updatedAt) latest = preview;
    }
  }
  return latest;
}

export function selectCodexReasoningPreviewForThread(
  currentThreadKey: string,
  directPreview: ActiveCodexReasoningPreview | null | undefined,
  rowStatuses: Record<string, BoardRowSessionStatus> | undefined,
): ActiveCodexReasoningPreview | null {
  const projectedPreview = latestProjectedWorkerReasoningPreview(currentThreadKey, rowStatuses);
  const matchingDirectPreview =
    directPreview?.text?.trim() && activeReasoningMatchesThread(directPreview, currentThreadKey) ? directPreview : null;
  if (!matchingDirectPreview) return projectedPreview;
  if (!projectedPreview) return matchingDirectPreview;
  return projectedPreview.updatedAt > matchingDirectPreview.updatedAt ? projectedPreview : matchingDirectPreview;
}

function parseActiveReasoningText(text: string): { title: string | null; body: string } {
  const trimmed = text.trim();
  const titleMatch = trimmed.match(/^\*\*([^\n*][^\n]*?)\*\*(?:[ \t]*\n+|\s+|$)([\s\S]*)$/);
  if (!titleMatch?.[1]?.trim()) return { title: null, body: trimmed };
  return {
    title: titleMatch[1].trim(),
    body: (titleMatch[2] ?? "").trim(),
  };
}

export function ActiveCodexReasoningThreadRow({ preview }: { preview: ActiveCodexReasoningPreview }) {
  const parsed = parseActiveReasoningText(preview.text);
  const body = parsed.body || (parsed.title ? "" : preview.text.trim());
  if (!parsed.title && !body) return null;

  return (
    <div
      className="flex items-start gap-2 sm:gap-3"
      data-testid="active-codex-reasoning-thread-row"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      <PawTrailAvatar />
      <div className="min-w-0 flex-1 rounded-lg border border-cc-border/40 bg-cc-card/45 px-3 py-2.5 text-sm leading-relaxed text-cc-fg/90 shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-cc-muted">
          {parsed.title && (
            <>
              <strong className="font-semibold text-cc-fg" data-testid="active-codex-reasoning-title">
                {parsed.title}
              </strong>
              {body ? " " : null}
            </>
          )}
          {body && <span data-testid="active-codex-reasoning-body">{body}</span>}
        </p>
      </div>
    </div>
  );
}
