export const HERD_EVENT_LIFECYCLE_LABELS = {
  waiting_for_decision: "waiting for decision; Work preserved",
  decision_resolved: "decision resolved; wait ended",
  resumed_after_decision: "same Work resumed after decision wait",
  context_continued: "context compacted; same Work continued",
  idle_disconnected: "session disconnected while idle",
  interrupted: "Work interrupted",
  failed: "Work failed",
} as const;

export type TakodeHerdEventLifecycle = keyof typeof HERD_EVENT_LIFECYCLE_LABELS;

export const HERD_EVENT_LIFECYCLE_ORDER: readonly TakodeHerdEventLifecycle[] = [
  "failed",
  "interrupted",
  "waiting_for_decision",
  "decision_resolved",
  "resumed_after_decision",
  "context_continued",
  "idle_disconnected",
];
