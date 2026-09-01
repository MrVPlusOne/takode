import {
  appendMemoryCatalogToUserMessage,
  hasMemoryCatalogHistoryFollowUp,
  type MemoryCatalogInjectionBundle,
} from "../memory-catalog-injection-utils.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";
import type { BrowserUserMessage } from "./adapter-browser-routing-message-types.js";

export interface StartupMemoryCatalogAttachment {
  message: BrowserUserMessage;
  bundle?: MemoryCatalogInjectionBundle;
  consumePendingOnAccepted: boolean;
}

export async function attachStartupMemoryCatalogPrelude(
  session: AdapterBrowserRoutingSessionLike,
  message: BrowserUserMessage,
  deps: AdapterBrowserRoutingDeps,
): Promise<StartupMemoryCatalogAttachment> {
  if (!session.pendingStartupMemoryCatalogInjection) {
    return { message, consumePendingOnAccepted: false };
  }
  if (hasMemoryCatalogHistoryFollowUp(message)) {
    return { message, consumePendingOnAccepted: true };
  }
  const build = deps.buildMemoryCatalogInjectionBundle;
  if (!build) return { message, consumePendingOnAccepted: false };

  try {
    const bundle = await build(session);
    return {
      message: appendMemoryCatalogToUserMessage(message, bundle),
      bundle,
      consumePendingOnAccepted: true,
    };
  } catch (error) {
    console.error("[ws-bridge] Failed to build startup memory catalog context:", error);
    return { message, consumePendingOnAccepted: false };
  }
}
