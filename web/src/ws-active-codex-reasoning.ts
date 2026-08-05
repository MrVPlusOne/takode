import type { ActiveCodexReasoningPreview, BrowserIncomingMessage } from "./types.js";
import type { AppState } from "./store-types.js";

const ACTIVE_CODEX_REASONING_PREVIEW_LIMIT = 4_000;

type ActiveCodexReasoningStore = Pick<
  AppState,
  "activeCodexReasoningPreviews" | "activeTurnRoutes" | "setActiveCodexReasoningPreview"
>;

function boundedActiveCodexReasoningPreview(text: string): Pick<ActiveCodexReasoningPreview, "text" | "truncated"> {
  if (text.length <= ACTIVE_CODEX_REASONING_PREVIEW_LIMIT) return { text };
  return {
    text: text.slice(-ACTIVE_CODEX_REASONING_PREVIEW_LIMIT),
    truncated: true,
  };
}

export function updateActiveCodexReasoningPreviewFromStream(
  sessionId: string,
  data: Extract<BrowserIncomingMessage, { type: "stream_event" }>,
  store: ActiveCodexReasoningStore,
): void {
  if (data.parent_tool_use_id !== null) return;
  const evt = data.event as
    | {
        type?: unknown;
        content_block?: { type?: unknown; thinking?: unknown };
        delta?: { type?: unknown; thinking?: unknown };
      }
    | undefined;
  if (!evt || typeof evt !== "object") return;
  const startText =
    evt.type === "content_block_start" && evt.content_block?.type === "thinking"
      ? typeof evt.content_block.thinking === "string"
        ? evt.content_block.thinking
        : ""
      : null;
  const deltaText =
    evt.type === "content_block_delta" && evt.delta?.type === "thinking_delta"
      ? typeof evt.delta.thinking === "string"
        ? evt.delta.thinking
        : ""
      : null;
  if (startText === null && deltaText === null) return;
  const existing = deltaText !== null ? store.activeCodexReasoningPreviews.get(sessionId)?.text || "" : "";
  const rawText = deltaText !== null ? existing + deltaText : startText || "";
  if (rawText.trim().length === 0) {
    store.setActiveCodexReasoningPreview(sessionId, null);
    return;
  }
  const activeTurnRoute = store.activeTurnRoutes.get(sessionId) ?? null;
  store.setActiveCodexReasoningPreview(sessionId, {
    ...boundedActiveCodexReasoningPreview(rawText),
    updatedAt: Date.now(),
    ...(activeTurnRoute?.threadKey ? { threadKey: activeTurnRoute.threadKey } : {}),
    ...(activeTurnRoute?.questId ? { questId: activeTurnRoute.questId } : {}),
  });
}
