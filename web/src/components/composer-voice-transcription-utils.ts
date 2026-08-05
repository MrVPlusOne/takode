import type { VoiceTranscriptionFrontendTimingEvent, VoiceTranscriptionPhase } from "../api.js";

export function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function createVoiceTranscriptionRequestId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `voice-${Date.now()}-${random}`;
}

export function afterNextPaint(): Promise<number> {
  return new Promise((resolve) => {
    const finish = () => resolve(Date.now());
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(finish);
    else setTimeout(finish, 0);
  });
}

export function calculateVoiceTranscriptionPhaseDurations(
  events: VoiceTranscriptionFrontendTimingEvent[],
  totalElapsedMs: number,
): Partial<Record<VoiceTranscriptionPhase, number>> {
  const durations: Partial<Record<VoiceTranscriptionPhase, number>> = {};
  let currentPhase: VoiceTranscriptionPhase | null = null;
  let currentStartMs = 0;

  for (const event of events) {
    const eventElapsedMs = Math.max(0, event.elapsedMs);
    if (event.phase === "complete" || event.phase === "error") {
      if (currentPhase) {
        durations[currentPhase] = (durations[currentPhase] ?? 0) + Math.max(0, eventElapsedMs - currentStartMs);
        currentPhase = null;
      }
      continue;
    }

    if (event.phase === currentPhase) continue;
    if (currentPhase) {
      durations[currentPhase] = (durations[currentPhase] ?? 0) + Math.max(0, eventElapsedMs - currentStartMs);
    }
    currentPhase = event.phase;
    currentStartMs = eventElapsedMs;
  }

  if (currentPhase) {
    durations[currentPhase] = (durations[currentPhase] ?? 0) + Math.max(0, totalElapsedMs - currentStartMs);
  }
  return durations;
}
