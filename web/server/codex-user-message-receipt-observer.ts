export interface CodexUserMessageReceipt {
  clientUserMessageId: string;
  turnId: string;
  itemId: string | null;
  observedAt: number;
}

export type CodexUserMessageReceiptCallback = (receipt: CodexUserMessageReceipt) => void;

type ClientUserMessageCarrier = {
  clientUserMessageId?: unknown;
  pendingInputIds?: unknown;
};

type CodexBatchInputEntry = {
  content: string;
  vscodeSelection?: {
    absolutePath: string;
    relativePath: string;
    displayPath: string;
    startLine: number;
    endLine: number;
    lineCount: number;
  };
};

const RECEIPT_CACHE_LIMIT = 512;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function resolveCodexClientUserMessageId(message: ClientUserMessageCarrier): string | null {
  const explicit = nonEmptyString(message.clientUserMessageId);
  if (explicit) return explicit;
  if (!Array.isArray(message.pendingInputIds)) return null;
  return nonEmptyString(message.pendingInputIds[0]);
}

export function buildCodexBatchInput(
  entries: CodexBatchInputEntry[],
  formatSelection: (selection: NonNullable<CodexBatchInputEntry["vscodeSelection"]>) => string,
): Array<{ type: string; text?: string; path?: string; text_elements?: unknown[] }> {
  const input: Array<{ type: string; text?: string; path?: string; text_elements?: unknown[] }> = [];
  for (const entry of entries) {
    input.push({ type: "text", text: entry.content, text_elements: [] });
    if (entry.vscodeSelection) {
      input.push({ type: "text", text: formatSelection(entry.vscodeSelection), text_elements: [] });
    }
  }
  return input;
}

function parseCodexUserMessageReceipt(
  params: Record<string, unknown>,
): Omit<CodexUserMessageReceipt, "observedAt"> | null {
  const item = params.item;
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  if (record.type !== "userMessage") return null;

  const clientUserMessageId = nonEmptyString(record.clientId);
  const turnId = nonEmptyString(params.turnId);
  if (!clientUserMessageId || !turnId) return null;

  return {
    clientUserMessageId,
    turnId,
    itemId: nonEmptyString(record.id),
  };
}

function receiptKey(receipt: Pick<CodexUserMessageReceipt, "clientUserMessageId" | "turnId" | "itemId">): string {
  return `${receipt.clientUserMessageId}\u0000${receipt.turnId}\u0000${receipt.itemId ?? ""}`;
}

function addBounded(set: Set<string>, value: string): void {
  set.delete(value);
  set.add(value);
  while (set.size > RECEIPT_CACHE_LIMIT) {
    const oldest = set.values().next().value;
    if (typeof oldest !== "string") break;
    set.delete(oldest);
  }
}

/**
 * Correlates Codex userMessage item notifications with an acknowledged
 * turn/start or turn/steer request. Notifications may race ahead of the RPC
 * response, so receipts stay buffered until their client id is acknowledged.
 */
export class CodexUserMessageReceiptObserver {
  private callback: CodexUserMessageReceiptCallback | null = null;
  private observationCallback: CodexUserMessageReceiptCallback | null = null;
  private readonly acknowledgedClientIds = new Set<string>();
  private readonly receipts = new Map<string, CodexUserMessageReceipt>();
  private readonly deliveredReceiptKeys = new Set<string>();
  private readonly deliveredObservationKeys = new Set<string>();

  setCallback(callback: CodexUserMessageReceiptCallback): void {
    this.callback = callback;
    this.flushReadyReceipts();
  }

  setObservationCallback(callback: CodexUserMessageReceiptCallback): void {
    this.observationCallback = callback;
    for (const [key, receipt] of this.receipts) this.deliverObservation(key, receipt);
  }

  acknowledge(clientUserMessageId: string | null): void {
    if (!clientUserMessageId) return;
    addBounded(this.acknowledgedClientIds, clientUserMessageId);
    this.flushReadyReceipts(clientUserMessageId);
  }

  observe(params: Record<string, unknown>): void {
    const parsed = parseCodexUserMessageReceipt(params);
    if (!parsed) return;
    const key = receiptKey(parsed);
    const receipt = { ...parsed, observedAt: Date.now() };
    if (!this.receipts.has(key)) {
      this.receipts.set(key, receipt);
      this.trimReceiptCache();
    }
    this.deliverObservation(key, this.receipts.get(key) ?? receipt);
    if (this.acknowledgedClientIds.has(receipt.clientUserMessageId)) {
      this.deliver(key, receipt);
    }
  }

  private flushReadyReceipts(clientUserMessageId?: string): void {
    for (const [key, receipt] of this.receipts) {
      if (clientUserMessageId && receipt.clientUserMessageId !== clientUserMessageId) continue;
      if (!this.acknowledgedClientIds.has(receipt.clientUserMessageId)) continue;
      this.deliver(key, receipt);
    }
  }

  private deliver(key: string, receipt: CodexUserMessageReceipt): void {
    if (!this.callback || this.deliveredReceiptKeys.has(key)) return;
    this.callback(receipt);
    addBounded(this.deliveredReceiptKeys, key);
  }

  private deliverObservation(key: string, receipt: CodexUserMessageReceipt): void {
    if (!this.observationCallback || this.deliveredObservationKeys.has(key)) return;
    this.observationCallback(receipt);
    addBounded(this.deliveredObservationKeys, key);
  }

  private trimReceiptCache(): void {
    while (this.receipts.size > RECEIPT_CACHE_LIMIT) {
      const oldest = this.receipts.keys().next().value;
      if (typeof oldest !== "string") break;
      this.receipts.delete(oldest);
      this.deliveredReceiptKeys.delete(oldest);
      this.deliveredObservationKeys.delete(oldest);
    }
  }
}
