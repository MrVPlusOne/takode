export type VoiceTranscriptionMode = "dictation" | "edit" | "append";
export type VoiceTranscriptionPhase = "preparing" | "transcribing" | "enhancing" | "editing" | "appending";
export type VoiceTranscriptionProgressPhase = VoiceTranscriptionPhase | "complete" | "error";

export interface VoiceTranscriptionTiming {
  uploadDurationMs?: number;
  sttDurationMs?: number;
  enhancementDurationMs?: number;
  audioSizeBytes?: number;
  audioMimeType?: string | null;
  audioFileName?: string | null;
}

export interface VoiceTranscriptionProgressEvent {
  requestId: string;
  phase: VoiceTranscriptionProgressPhase;
  mode?: VoiceTranscriptionMode;
  timestamp: number;
  source: "client" | "sse" | "websocket";
  timing?: VoiceTranscriptionTiming;
  error?: string;
}

type TranscriptionProgressHandler = (event: VoiceTranscriptionProgressEvent) => void;

const transcriptionProgressHandlers = new Map<string, Set<TranscriptionProgressHandler>>();

export function subscribeTranscriptionProgress(requestId: string, handler: TranscriptionProgressHandler): () => void {
  const handlers = transcriptionProgressHandlers.get(requestId) ?? new Set<TranscriptionProgressHandler>();
  handlers.add(handler);
  transcriptionProgressHandlers.set(requestId, handlers);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) transcriptionProgressHandlers.delete(requestId);
  };
}

export function handleTranscriptionProgressMessage(event: Omit<VoiceTranscriptionProgressEvent, "source">): void {
  const handlers = transcriptionProgressHandlers.get(event.requestId);
  if (!handlers) return;
  const progress = { ...event, source: "websocket" as const };
  for (const handler of handlers) {
    handler(progress);
  }
}

export function _clearTranscriptionProgressHandlersForTest(): void {
  transcriptionProgressHandlers.clear();
}
