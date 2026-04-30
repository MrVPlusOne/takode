import type { WsBridge } from "../ws-bridge.js";
import type { BrowserIncomingMessage } from "../session-types.js";

export function broadcastQuestUpdate(wsBridge: WsBridge): void {
  wsBridge.broadcastGlobal({ type: "quest_list_updated" } as BrowserIncomingMessage);
}
