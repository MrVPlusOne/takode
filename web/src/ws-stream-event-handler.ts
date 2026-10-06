import { useStore } from "./store.js";
import type { BrowserIncomingMessage } from "./types.js";

type StreamEventMessage = Extract<BrowserIncomingMessage, { type: "stream_event" }>;

/**
 * Apply root-agent generation stats. The server never sends live answer or
 * thinking text, so stream events only carry message boundaries and usage.
 */
export function handleStreamEventMessage(sessionId: string, data: StreamEventMessage): void {
  if (data.codexSubagent) return;
  const store = useStore.getState();
  const event = data.event as Record<string, unknown>;
  if (!event || typeof event !== "object") return;

  if (event.type === "message_start" && !store.streamingStartedAt.has(sessionId)) {
    store.setStreamingStats(sessionId, { startedAt: Date.now(), outputTokens: 0 });
  }

  if (event.type === "message_delta") {
    const usage = (event as { usage?: { output_tokens?: number } }).usage;
    if (usage?.output_tokens) store.setStreamingStats(sessionId, { outputTokens: usage.output_tokens });
  }
}
