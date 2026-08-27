export type QuestOwnerKind = "takode" | "codex";

export interface QuestOwnerRef {
  kind: QuestOwnerKind;
  sessionId: string;
}

/** Server-recorded identity and invocation context for a Quest mutation. */
export interface QuestInvocationProvenance {
  owner: QuestOwnerRef;
  /** Codex turn that initiated the mutation, when supplied by the caller. */
  turnId?: string;
  /** Tool invocation that initiated the mutation, when supplied by the caller. */
  toolUseId?: string;
  /** Caller working directory at invocation time, when supplied by the caller. */
  cwd?: string;
  /** Server timestamp when the mutation was accepted. */
  recordedAt: number;
}

type QuestOwnerFields = {
  ownerKind?: unknown;
  previousOwners?: unknown;
  previousOwnerSessionIds?: unknown;
  sessionId?: unknown;
};

export function getQuestOwner(value: QuestOwnerFields): QuestOwnerRef | undefined {
  const sessionId = normalizeSessionId(value.sessionId);
  if (!sessionId) return undefined;
  const kind = normalizeOwnerKind(value.ownerKind, true);
  return kind ? { kind, sessionId } : undefined;
}

export function getPreviousQuestOwners(value: QuestOwnerFields): QuestOwnerRef[] {
  const owners: QuestOwnerRef[] = [];
  const seen = new Set<string>();
  const add = (owner: QuestOwnerRef | undefined) => {
    if (!owner) return;
    const key = questOwnerKey(owner);
    if (seen.has(key)) return;
    seen.add(key);
    owners.push(owner);
  };

  if (Array.isArray(value.previousOwners)) {
    for (const raw of value.previousOwners) add(normalizeQuestOwnerRef(raw));
  }
  if (Array.isArray(value.previousOwnerSessionIds)) {
    for (const raw of value.previousOwnerSessionIds) {
      const sessionId = normalizeSessionId(raw);
      if (sessionId) add({ kind: "takode", sessionId });
    }
  }
  return owners;
}

export function getTakodeQuestOwnerSessionId(value: QuestOwnerFields): string | undefined {
  const owner = getQuestOwner(value);
  return owner?.kind === "takode" ? owner.sessionId : undefined;
}

/** Resolve the active owner, or the newest provider-aware historical owner for display. */
export function getQuestDisplayOwner(value: QuestOwnerFields): QuestOwnerRef | undefined {
  const active = getQuestOwner(value);
  if (active) return active;

  if (Array.isArray(value.previousOwners)) {
    for (let index = value.previousOwners.length - 1; index >= 0; index -= 1) {
      const owner = normalizeQuestOwnerRef(value.previousOwners[index]);
      if (owner) return owner;
    }
  }
  return getPreviousQuestOwners(value).at(-1);
}

export function normalizeQuestOwnerRef(value: unknown): QuestOwnerRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as { kind?: unknown; sessionId?: unknown };
  const kind = normalizeOwnerKind(raw.kind, false);
  const sessionId = normalizeSessionId(raw.sessionId);
  return kind && sessionId ? { kind, sessionId } : undefined;
}

export function questOwnerKey(owner: QuestOwnerRef): string {
  return `${owner.kind}:${owner.sessionId}`;
}

export function sameQuestOwner(left: QuestOwnerRef | undefined, right: QuestOwnerRef | undefined): boolean {
  return !!left && !!right && left.kind === right.kind && left.sessionId === right.sessionId;
}

function normalizeOwnerKind(value: unknown, defaultTakode: boolean): QuestOwnerKind | undefined {
  if (value === "takode" || value === "codex") return value;
  if (defaultTakode && (value === undefined || value === null || value === "")) return "takode";
  return undefined;
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sessionId = value.trim();
  return sessionId || undefined;
}
