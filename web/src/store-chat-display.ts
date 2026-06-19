import type { AppSettings } from "./api.js";
import { DEFAULT_CHAT_MESSAGE_LINE_HEIGHT, normalizeChatMessageLineHeight } from "../shared/chat-display-settings.js";

export function getInitialChatMessageLineHeight(): number {
  return DEFAULT_CHAT_MESSAGE_LINE_HEIGHT;
}

export function createChatDisplaySettingsHydrator(applyServerLineHeight: (lineHeight: number) => void) {
  return function hydrateChatDisplaySettingsFromServer(settings: Pick<AppSettings, "chatMessageLineHeight">): void {
    applyServerLineHeight(normalizeChatMessageLineHeight(settings.chatMessageLineHeight));
  };
}

export { normalizeChatMessageLineHeight };
