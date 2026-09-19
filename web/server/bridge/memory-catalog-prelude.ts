import {
  appendMemoryCatalogToUserMessage,
  hasMemoryCatalogHistoryFollowUp,
  recordMemoryCatalogSeenAfterDelivery,
  type MemoryCatalogInjectionBundle,
} from "../memory-catalog-injection-utils.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { CODEX_LOCAL_SLASH_COMMANDS } from "../../shared/codex-slash-commands.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";
import type { BrowserUserMessage } from "./adapter-browser-routing-message-types.js";
import { normalizeAdapterUserMessage } from "./user-message-delivery.js";

/** Keep fulfilled boundary identity too, so callback replay or restart cannot rearm it. */
export interface CompactionMemoryCatalogState {
  boundaryId: string;
  pending: boolean;
}

interface MemoryCatalogSession {
  pendingStartupMemoryCatalogInjection?: boolean;
  compactionMemoryCatalog?: CompactionMemoryCatalogState;
}

export interface MemoryCatalogAttachment {
  message: BrowserUserMessage;
  bundle?: MemoryCatalogInjectionBundle;
  consumeStartupOnAccepted: boolean;
  compactionBoundaryId?: string;
}

/** Remember the completed boundary without creating an input or waking the model. */
export function requestCompactionMemoryCatalog(
  session: MemoryCatalogSession & { messageHistory: BrowserIncomingMessage[] },
): void {
  const marker = session.messageHistory.findLast((entry) => entry.type === "compact_marker");
  if (marker?.type !== "compact_marker" || marker.compactionStatus !== "completed") return;
  const boundaryId = marker.id ?? String(marker.timestamp);
  if (session.compactionMemoryCatalog?.boundaryId === boundaryId) return;
  session.compactionMemoryCatalog = { boundaryId, pending: true };
}

export function hasPendingMemoryCatalog(session: MemoryCatalogSession): boolean {
  return session.pendingStartupMemoryCatalogInjection === true || session.compactionMemoryCatalog?.pending === true;
}

export function normalizeCompactionMemoryCatalog(value: unknown): CompactionMemoryCatalogState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Partial<CompactionMemoryCatalogState>;
  if (typeof state.boundaryId !== "string" || !state.boundaryId || typeof state.pending !== "boolean") return undefined;
  return { boundaryId: state.boundaryId, pending: state.pending };
}

export async function attachMemoryCatalogPrelude(
  session: AdapterBrowserRoutingSessionLike,
  message: BrowserUserMessage,
  deps: AdapterBrowserRoutingDeps,
): Promise<MemoryCatalogAttachment> {
  const unchanged: MemoryCatalogAttachment = { message, consumeStartupOnAccepted: false };
  if (!hasPendingMemoryCatalog(session)) return unchanged;
  // Local commands do not deliver ordinary model input, even when written as chat text.
  if (
    session.backendType === "codex" &&
    !message.imageRefs?.length &&
    !message.annotations?.length &&
    CODEX_LOCAL_SLASH_COMMANDS.some((command) => message.content.trim().toLowerCase() === `/${command}`)
  )
    return unchanged;
  const compactionBoundaryId = session.compactionMemoryCatalog?.pending
    ? session.compactionMemoryCatalog.boundaryId
    : undefined;
  const consumeStartupOnAccepted = session.pendingStartupMemoryCatalogInjection === true;
  if (hasMemoryCatalogHistoryFollowUp(message)) {
    return { message, consumeStartupOnAccepted, compactionBoundaryId };
  }
  const build = deps.buildMemoryCatalogInjectionBundle;
  if (!build) return unchanged;

  try {
    const bundle = await build(session);
    // A scan started for an older boundary cannot satisfy a newer compaction.
    if (compactionBoundaryId && session.compactionMemoryCatalog?.boundaryId !== compactionBoundaryId) return unchanged;
    // Compile the same path-only attachment body that ordinary adapter delivery uses.
    // Setting deliveryContent before that compilation would hide imageRefs from the model.
    const primary = normalizeAdapterUserMessage(session, message, message.imageRefs);
    if (primary?.type !== "user_message") return unchanged;
    return {
      message: appendMemoryCatalogToUserMessage({ ...message, deliveryContent: primary.content }, bundle),
      bundle,
      consumeStartupOnAccepted,
      compactionBoundaryId,
    };
  } catch (error) {
    console.error("[ws-bridge] Failed to build memory catalog context:", error);
    return { ...unchanged, compactionBoundaryId };
  }
}

/** Consume only the request whose ordinary input was accepted; failures never mark a catalog seen. */
export function acceptMemoryCatalogPrelude(session: MemoryCatalogSession, attachment: MemoryCatalogAttachment): void {
  if (attachment.consumeStartupOnAccepted) session.pendingStartupMemoryCatalogInjection = false;
  if (
    attachment.compactionBoundaryId === session.compactionMemoryCatalog?.boundaryId &&
    session.compactionMemoryCatalog
  ) {
    session.compactionMemoryCatalog.pending = false;
  }
  recordMemoryCatalogSeenAfterDelivery(attachment.bundle);
}
