import { toSafeText } from "./codex-adapter-utils.js";

export interface CodexReasoningDetailPartUpdate {
  sourceId: string;
  turnId: string;
  itemOrdinal: number;
  providerItemId: string;
  text: string;
  status: "streaming" | "complete";
  parentToolUseId: string | null;
  summaryIndex: number;
  thinkingTimeMs?: number;
}

interface ReasoningGroup {
  key: string;
  turnId: string;
  ordinal: number;
  parentToolUseId: string | null;
  currentProviderItemId: string;
  itemIds: Set<string>;
  parts: Map<number, string>;
  thinkingTimeMs?: number;
}

function normalizedSummaryIndex(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function normalizeReasoningSummaryParts(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((part) => toSafeText(part));
  const text = toSafeText(value);
  return text ? [text] : [];
}

export class CodexReasoningDetailAssembler {
  private readonly groups = new Map<string, ReasoningGroup>();
  private readonly groupKeyByItemId = new Map<string, string>();
  private readonly activeGroupKeyByTurnId = new Map<string, string>();
  private readonly nextOrdinalByTurnId = new Map<string, number>();

  reset(): void {
    this.groups.clear();
    this.groupKeyByItemId.clear();
    this.activeGroupKeyByTurnId.clear();
    this.nextOrdinalByTurnId.clear();
  }

  finishTurn(rawTurnId: string): void {
    const turnId = rawTurnId.trim();
    if (!turnId) return;
    for (const [key, group] of this.groups) {
      if (group.turnId !== turnId) continue;
      for (const itemId of group.itemIds) this.groupKeyByItemId.delete(itemId);
      this.groups.delete(key);
    }
    this.activeGroupKeyByTurnId.delete(turnId);
    this.nextOrdinalByTurnId.delete(turnId);
  }

  start(options: {
    turnId?: string;
    itemId: string;
    summary: unknown;
    parentToolUseId: string | null;
    thinkingTimeMs?: number;
  }): CodexReasoningDetailPartUpdate[] {
    const aliasedKey = this.groupKeyByItemId.get(options.itemId);
    const group =
      (aliasedKey ? this.groups.get(aliasedKey) : undefined) ??
      this.createGroup(options.turnId, options.itemId, options.parentToolUseId, options.thinkingTimeMs);
    const parts = normalizeReasoningSummaryParts(options.summary);
    for (let index = 0; index < parts.length; index++) group.parts.set(index, parts[index] ?? "");
    return this.updatesFor(group, "streaming");
  }

  addPart(options: { turnId?: string; itemId: string; summaryIndex: unknown; parentToolUseId: string | null }): void {
    const group = this.findOrCreateActiveGroup(options.turnId, options.itemId, options.parentToolUseId);
    const index = normalizedSummaryIndex(options.summaryIndex);
    if (!group.parts.has(index)) group.parts.set(index, "");
  }

  appendDelta(options: {
    turnId?: string;
    itemId: string;
    summaryIndex: unknown;
    delta: string;
    parentToolUseId: string | null;
  }): CodexReasoningDetailPartUpdate[] {
    if (!options.delta) return [];
    const group = this.findOrCreateActiveGroup(options.turnId, options.itemId, options.parentToolUseId);
    const index = normalizedSummaryIndex(options.summaryIndex);
    group.parts.set(index, (group.parts.get(index) ?? "") + options.delta);
    return [this.toUpdate(group, index, "streaming")];
  }

  complete(options: {
    turnId?: string;
    itemId: string;
    summary: unknown;
    parentToolUseId: string | null;
    thinkingTimeMs?: number;
  }): CodexReasoningDetailPartUpdate[] {
    const turnId = this.normalizeTurnId(options.turnId, options.itemId);
    const group =
      this.findGroup(options.itemId, turnId) ?? this.createGroup(turnId, options.itemId, options.parentToolUseId);
    this.aliasItem(group, options.itemId);
    if (group.parentToolUseId === null && options.parentToolUseId !== null) {
      group.parentToolUseId = options.parentToolUseId;
    }
    if (group.thinkingTimeMs === undefined && options.thinkingTimeMs !== undefined) {
      group.thinkingTimeMs = options.thinkingTimeMs;
    }

    const completedParts = normalizeReasoningSummaryParts(options.summary);
    for (let index = 0; index < completedParts.length; index++) {
      const completedText = completedParts[index] ?? "";
      if (completedText.trim() || !group.parts.has(index)) group.parts.set(index, completedText);
    }
    if (this.activeGroupKeyByTurnId.get(group.turnId) === group.key) {
      this.activeGroupKeyByTurnId.delete(group.turnId);
    }
    return this.updatesFor(group, "complete");
  }

  private createGroup(
    rawTurnId: string | undefined,
    itemId: string,
    parentToolUseId: string | null,
    thinkingTimeMs?: number,
  ): ReasoningGroup {
    const turnId = this.normalizeTurnId(rawTurnId, itemId);
    const ordinal = this.nextOrdinalByTurnId.get(turnId) ?? 0;
    this.nextOrdinalByTurnId.set(turnId, ordinal + 1);
    const key = `${turnId}:${ordinal}`;
    const group: ReasoningGroup = {
      key,
      turnId,
      ordinal,
      parentToolUseId,
      currentProviderItemId: itemId,
      itemIds: new Set([itemId]),
      parts: new Map(),
      thinkingTimeMs,
    };
    this.groups.set(key, group);
    this.aliasItem(group, itemId);
    this.activeGroupKeyByTurnId.set(turnId, key);
    return group;
  }

  private findOrCreateActiveGroup(
    rawTurnId: string | undefined,
    itemId: string,
    parentToolUseId: string | null,
  ): ReasoningGroup {
    const turnId = this.normalizeTurnId(rawTurnId, itemId);
    const existing = this.findGroup(itemId, turnId);
    if (existing) {
      this.aliasItem(existing, itemId);
      return existing;
    }
    return this.createGroup(turnId, itemId, parentToolUseId);
  }

  private findGroup(itemId: string, turnId: string): ReasoningGroup | undefined {
    const aliasedKey = this.groupKeyByItemId.get(itemId);
    if (aliasedKey) return this.groups.get(aliasedKey);
    const activeKey = this.activeGroupKeyByTurnId.get(turnId);
    return activeKey ? this.groups.get(activeKey) : undefined;
  }

  private aliasItem(group: ReasoningGroup, itemId: string): void {
    if (!itemId) return;
    group.currentProviderItemId = itemId;
    group.itemIds.add(itemId);
    this.groupKeyByItemId.set(itemId, group.key);
  }

  private normalizeTurnId(turnId: string | undefined, itemId: string): string {
    return turnId?.trim() || `legacy-item-${itemId}`;
  }

  private updatesFor(group: ReasoningGroup, status: "streaming" | "complete"): CodexReasoningDetailPartUpdate[] {
    return [...group.parts.keys()]
      .sort((left, right) => left - right)
      .map((index) => this.toUpdate(group, index, status))
      .filter((update) => update.text.trim().length > 0);
  }

  private toUpdate(
    group: ReasoningGroup,
    summaryIndex: number,
    status: "streaming" | "complete",
  ): CodexReasoningDetailPartUpdate {
    return {
      sourceId: `${encodeURIComponent(group.turnId)}-${group.ordinal}-${summaryIndex}`,
      turnId: group.turnId,
      itemOrdinal: group.ordinal,
      providerItemId: group.currentProviderItemId,
      text: group.parts.get(summaryIndex) ?? "",
      status,
      parentToolUseId: group.parentToolUseId,
      summaryIndex,
      ...(group.thinkingTimeMs !== undefined ? { thinkingTimeMs: group.thinkingTimeMs } : {}),
    };
  }
}
