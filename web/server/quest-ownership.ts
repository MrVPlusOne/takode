import type { QuestOwnershipEvent, QuestOwnershipEventDraft, QuestOwnershipOperation } from "./quest-types.js";

export type QuestOwnershipEventInput = QuestOwnershipEventDraft;

export function ownershipEventDraft(input: QuestOwnershipEventInput): QuestOwnershipEventDraft {
  return {
    operation: input.operation,
    actorSessionId: input.actorSessionId.trim(),
    previousOwnerSessionId: input.previousOwnerSessionId.trim(),
    newOwnerSessionId: input.newOwnerSessionId.trim(),
    reason: input.reason.trim(),
    ...(input.previousLeaderSessionId?.trim() ? { previousLeaderSessionId: input.previousLeaderSessionId.trim() } : {}),
    ...(input.newLeaderSessionId?.trim() ? { newLeaderSessionId: input.newLeaderSessionId.trim() } : {}),
  };
}

export function archivedOwnerTakeoverEvent(input: {
  actorSessionId: string;
  previousOwnerSessionId: string;
  newLeaderSessionId?: string;
  previousLeaderSessionId?: string;
}): QuestOwnershipEventDraft {
  return ownershipEventDraft({
    operation: "archived_owner_takeover",
    actorSessionId: input.actorSessionId,
    previousOwnerSessionId: input.previousOwnerSessionId,
    newOwnerSessionId: input.actorSessionId,
    reason: "previous owner archived",
    ...(input.previousLeaderSessionId ? { previousLeaderSessionId: input.previousLeaderSessionId } : {}),
    ...(input.newLeaderSessionId ? { newLeaderSessionId: input.newLeaderSessionId } : {}),
  });
}

export function normalizeOwnershipEvents(raw: unknown): QuestOwnershipEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: QuestOwnershipEvent[] = [];
  for (const value of raw) {
    const event = normalizeOwnershipEvent(value);
    if (event) events.push(event);
  }
  return events;
}

export function appendOwnershipEvent(
  existing: readonly QuestOwnershipEvent[] | undefined,
  input: QuestOwnershipEventInput | undefined,
  now: number,
): QuestOwnershipEvent[] | undefined {
  const normalizedExisting = normalizeOwnershipEvents(existing);
  if (!input) return normalizedExisting.length > 0 ? normalizedExisting : undefined;
  const event = buildOwnershipEvent(input, now);
  return [...normalizedExisting, event];
}

function buildOwnershipEvent(input: QuestOwnershipEventInput, now: number): QuestOwnershipEvent {
  const operation = normalizeOwnershipOperation(input.operation);
  if (!operation) throw new Error(`Invalid ownership operation: ${input.operation}`);
  const actorSessionId = requireSessionId(input.actorSessionId, "actorSessionId");
  const previousOwnerSessionId = requireSessionId(input.previousOwnerSessionId, "previousOwnerSessionId");
  const newOwnerSessionId = requireSessionId(input.newOwnerSessionId, "newOwnerSessionId");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Ownership takeover reason is required");
  const previousLeaderSessionId = optionalSessionId(input.previousLeaderSessionId);
  const newLeaderSessionId = optionalSessionId(input.newLeaderSessionId);
  return {
    operation,
    actorSessionId,
    previousOwnerSessionId,
    newOwnerSessionId,
    ts: now,
    reason,
    ...(previousLeaderSessionId ? { previousLeaderSessionId } : {}),
    ...(newLeaderSessionId ? { newLeaderSessionId } : {}),
  };
}

function normalizeOwnershipEvent(raw: unknown): QuestOwnershipEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Partial<QuestOwnershipEvent>;
  const operation = normalizeOwnershipOperation(value.operation);
  const actorSessionId = optionalSessionId(value.actorSessionId);
  const previousOwnerSessionId = optionalSessionId(value.previousOwnerSessionId);
  const newOwnerSessionId = optionalSessionId(value.newOwnerSessionId);
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  const ts = typeof value.ts === "number" && Number.isFinite(value.ts) && value.ts > 0 ? value.ts : 0;
  if (!operation || !actorSessionId || !previousOwnerSessionId || !newOwnerSessionId || !reason || !ts) return null;
  const previousLeaderSessionId = optionalSessionId(value.previousLeaderSessionId);
  const newLeaderSessionId = optionalSessionId(value.newLeaderSessionId);
  return {
    operation,
    actorSessionId,
    previousOwnerSessionId,
    newOwnerSessionId,
    ts,
    reason,
    ...(previousLeaderSessionId ? { previousLeaderSessionId } : {}),
    ...(newLeaderSessionId ? { newLeaderSessionId } : {}),
  };
}

function normalizeOwnershipOperation(value: unknown): QuestOwnershipOperation | null {
  if (value === "force_claim" || value === "reassign" || value === "archived_owner_takeover") return value;
  return null;
}

function requireSessionId(value: string, label: string): string {
  const sessionId = optionalSessionId(value);
  if (!sessionId) throw new Error(`${label} is required for ownership audit`);
  return sessionId;
}

function optionalSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
