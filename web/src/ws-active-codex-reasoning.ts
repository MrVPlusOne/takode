import type { ActiveCodexReasoningPreview, BrowserIncomingMessage } from "./types.js";
import type { AppState } from "./store-types.js";

type ActiveCodexReasoningStore = Pick<
  AppState,
  "activeCodexReasoningPreviews" | "activeTurnRoutes" | "setActiveCodexReasoningPreview"
>;

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
  const isNonReasoningStart = evt.type === "content_block_start" && evt.content_block?.type !== "thinking";
  const isTextDelta = evt.type === "content_block_delta" && evt.delta?.type === "text_delta";
  if (isNonReasoningStart || isTextDelta) {
    store.setActiveCodexReasoningPreview(sessionId, null);
    return;
  }
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
  if (deltaText !== null && !store.activeCodexReasoningPreviews.get(sessionId)?.text) return;
  const existingPreview = store.activeCodexReasoningPreviews.get(sessionId);
  const existing = deltaText !== null ? existingPreview!.text : "";
  const rawText = deltaText !== null ? existing + deltaText : startText || "";
  if (rawText.trim().length === 0) {
    store.setActiveCodexReasoningPreview(sessionId, null);
    return;
  }
  const activeTurnRoute = store.activeTurnRoutes.get(sessionId) ?? null;
  const route = existingPreview ?? activeTurnRoute;
  store.setActiveCodexReasoningPreview(sessionId, {
    text: rawText,
    updatedAt: Date.now(),
    ...(route?.threadKey ? { threadKey: route.threadKey } : {}),
    ...(route?.questId ? { questId: route.questId } : {}),
  });
}
