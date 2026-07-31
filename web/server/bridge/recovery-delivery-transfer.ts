import { getCodexPendingInputMaxDeliveryBytes } from "../codex-pending-input-safety.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage, CodexAutoPauseRecoveryLink } from "../session-types.js";
import { markCodexAutoPauseRecoveryFailed } from "./codex-auto-pause-recovery-summary.js";
import { classifyRecoveryDeliveryOwnership, resolveRecoveryIngressOwnership } from "./browser-ingress-ownership.js";
import {
  handleBrowserIngressMessage,
  type BrowserTransportDeps,
  type BrowserTransportSessionLike,
} from "./browser-transport-controller.js";
import { getRecoveryDeliveryTransferId } from "./recovery-delivery-transfer-marker.js";

type RecoveryUserMessage = Extract<BrowserOutgoingMessage, { type: "user_message" }>;

export const RECOVERY_DELIVERY_TRANSFER_MAX_COUNT = 128;
export const RECOVERY_DELIVERY_TRANSFER_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const RECOVERY_DELIVERY_TRANSFER_METADATA_ALLOWANCE = 256 * 1024;

export interface RecoveryDeliveryTransfer {
  /**
   * While this entry exists it is the authoritative payload owner. The source
   * queue and later pending/terminal owner may overlap only across durability
   * barriers; restart cleanup always follows the transfer before either copy.
   */
  id: string;
  createdAt: number;
  sourceOwnerKind: "auto_pause" | "manual_pause";
  sourceOwnerId: string;
  payloadBytes: number;
  message: RecoveryUserMessage;
}

export interface RecoveryDeliveryTransferCandidate {
  sourceOwnerKind: RecoveryDeliveryTransfer["sourceOwnerKind"];
  sourceOwnerId: string;
  message: RecoveryUserMessage;
}

export interface RecoveryDeliveryTransferSessionLike extends BrowserTransportSessionLike {
  recoveryDeliveryTransfers: RecoveryDeliveryTransfer[];
}

export interface RecoveryDeliveryTransferDeps {
  broadcastToBrowsers: (session: any, message: BrowserIncomingMessage) => void;
  persistSession: (session: any) => void;
  persistSessionImmediately: (session: any) => Promise<void>;
  getBrowserTransportDeps: () => BrowserTransportDeps;
  releasePendingTransfer: (session: any, transferId: string) => void;
}

const activeTransferDeliveries = new WeakMap<RecoveryDeliveryTransferSessionLike, Set<string>>();

export function recoveryTransferMessage(
  message: RecoveryUserMessage,
  transferId: string,
): RecoveryUserMessage & { recoveryDeliveryTransferId: string } {
  return { ...message, recoveryDeliveryTransferId: transferId };
}

export async function beginRecoveryDeliveryTransferHandoff(
  session: RecoveryDeliveryTransferSessionLike,
  candidates: readonly RecoveryDeliveryTransferCandidate[],
  removeSourceOwners: () => void,
  deps: Pick<RecoveryDeliveryTransferDeps, "persistSessionImmediately">,
): Promise<Map<string, string>> {
  const prepared = prepareTransfers(session, candidates);
  await deps.persistSessionImmediately(session);
  removeSourceOwners();
  await deps.persistSessionImmediately(session);
  return new Map(prepared.map((entry) => [entry.sourceOwnerId, entry.id]));
}

export async function deliverRecoveryDeliveryTransfer(
  session: RecoveryDeliveryTransferSessionLike,
  transferId: string,
  deps: RecoveryDeliveryTransferDeps,
): Promise<void> {
  const transfer = session.recoveryDeliveryTransfers.find((entry) => entry.id === transferId);
  if (!transfer) return;
  const active = activeTransferDeliveries.get(session) ?? new Set<string>();
  if (active.has(transferId)) return;
  active.add(transferId);
  activeTransferDeliveries.set(session, active);
  try {
    const preflight = resolveRecoveryIngressOwnership(
      classifyRecoveryDeliveryOwnership(session, transfer.message),
      transfer.message,
    );
    let acceptedPending = false;
    if (preflight.status !== "owned") {
      const routedMessage = recoveryTransferMessage(transfer.message, transfer.id);
      const admission = await handleBrowserIngressMessage(
        session,
        routedMessage,
        undefined,
        deps.getBrowserTransportDeps(),
      );
      const ownership = resolveRecoveryIngressOwnership(admission, transfer.message);
      acceptedPending = admission.status === "accepted_pending_delivery";
      if (ownership.status === "unowned") {
        markCodexAutoPauseRecoveryFailed(session, ownership.links, Date.now(), deps, "delivery_pipeline_rejected");
      }
    } else {
      acceptedPending = hasPendingRecoveryOwner(session, transfer.message.autoPauseRecoveries ?? []);
    }

    // Persist the next owner while the transfer still retains the payload.
    await deps.persistSessionImmediately(session);
    session.recoveryDeliveryTransfers = session.recoveryDeliveryTransfers.filter((entry) => entry.id !== transferId);
    await deps.persistSessionImmediately(session);
    if (acceptedPending) deps.releasePendingTransfer(session, transferId);
  } finally {
    active.delete(transferId);
    if (active.size === 0) activeTransferDeliveries.delete(session);
  }
}

export async function resumeRecoveryDeliveryTransfers(
  session: RecoveryDeliveryTransferSessionLike,
  deps: RecoveryDeliveryTransferDeps,
): Promise<void> {
  if (session.recoveryDeliveryTransfers.length === 0) return;
  if (detachTransferSourceOwners(session)) {
    await deps.persistSessionImmediately(session);
  }
  for (const transfer of [...session.recoveryDeliveryTransfers]) {
    await deliverRecoveryDeliveryTransfer(session, transfer.id, deps);
  }
}

export function normalizePersistedRecoveryDeliveryTransfers(value: unknown): RecoveryDeliveryTransfer[] {
  if (!Array.isArray(value)) return [];
  const normalized: RecoveryDeliveryTransfer[] = [];
  let totalBytes = 0;
  for (const candidate of value) {
    if (normalized.length >= RECOVERY_DELIVERY_TRANSFER_MAX_COUNT) break;
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Partial<RecoveryDeliveryTransfer>;
    if (
      typeof record.id !== "string" ||
      !record.id.startsWith("recovery-transfer-") ||
      typeof record.createdAt !== "number" ||
      (record.sourceOwnerKind !== "auto_pause" && record.sourceOwnerKind !== "manual_pause") ||
      typeof record.sourceOwnerId !== "string" ||
      !record.message ||
      record.message.type !== "user_message" ||
      !record.message.autoPauseRecoveries?.length
    ) {
      continue;
    }
    const payloadBytes = measureTransferPayload(record.message);
    if (
      !isTransferPayloadBounded(payloadBytes) ||
      totalBytes + payloadBytes > RECOVERY_DELIVERY_TRANSFER_MAX_TOTAL_BYTES
    ) {
      continue;
    }
    totalBytes += payloadBytes;
    normalized.push({
      id: record.id,
      createdAt: record.createdAt,
      sourceOwnerKind: record.sourceOwnerKind,
      sourceOwnerId: record.sourceOwnerId,
      payloadBytes,
      message: stripTransientTransferMarker(record.message),
    });
  }
  return normalized;
}

function prepareTransfers(
  session: RecoveryDeliveryTransferSessionLike,
  candidates: readonly RecoveryDeliveryTransferCandidate[],
): RecoveryDeliveryTransfer[] {
  const existingById = new Map(session.recoveryDeliveryTransfers.map((entry) => [entry.id, entry]));
  const prepared: RecoveryDeliveryTransfer[] = [];
  const additions: RecoveryDeliveryTransfer[] = [];
  let totalBytes = session.recoveryDeliveryTransfers.reduce((total, entry) => total + entry.payloadBytes, 0);
  for (const candidate of candidates) {
    if (!candidate.message.autoPauseRecoveries?.length) continue;
    const id = transferId(candidate);
    const existing = existingById.get(id);
    if (existing) {
      if (
        existing.sourceOwnerKind !== candidate.sourceOwnerKind ||
        existing.sourceOwnerId !== candidate.sourceOwnerId ||
        recoveryLinkIdentity(existing.message) !== recoveryLinkIdentity(candidate.message)
      ) {
        throw new Error("Recovery delivery transfer identity collision; the existing pause owner was retained.");
      }
      prepared.push(existing);
      continue;
    }
    const payloadBytes = measureTransferPayload(candidate.message);
    if (
      session.recoveryDeliveryTransfers.length + additions.length >= RECOVERY_DELIVERY_TRANSFER_MAX_COUNT ||
      !isTransferPayloadBounded(payloadBytes) ||
      totalBytes + payloadBytes > RECOVERY_DELIVERY_TRANSFER_MAX_TOTAL_BYTES
    ) {
      throw new Error("Recovery delivery transfer capacity exceeded; the existing pause owner was retained.");
    }
    const transfer: RecoveryDeliveryTransfer = {
      id,
      createdAt: Date.now(),
      sourceOwnerKind: candidate.sourceOwnerKind,
      sourceOwnerId: candidate.sourceOwnerId,
      payloadBytes,
      message: stripTransientTransferMarker(candidate.message),
    };
    additions.push(transfer);
    existingById.set(id, transfer);
    prepared.push(transfer);
    totalBytes += payloadBytes;
  }
  session.recoveryDeliveryTransfers.push(...additions);
  return prepared;
}

function transferId(candidate: RecoveryDeliveryTransferCandidate): string {
  const links = recoveryLinkIdentity(candidate.message);
  const digest = boundedStableHash(`${candidate.sourceOwnerKind}\u0000${candidate.sourceOwnerId}\u0000${links}`);
  return `recovery-transfer-${digest}`;
}

function recoveryLinkIdentity(message: RecoveryUserMessage): string {
  return [...(message.autoPauseRecoveries ?? [])]
    .map((link) => `${link.summaryId}\u0000${link.groupId}`)
    .sort()
    .join("\u0001");
}

function boundedStableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}${value.length
    .toString(16)
    .padStart(8, "0")}`;
}

function measureTransferPayload(message: RecoveryUserMessage): number {
  return Buffer.byteLength(JSON.stringify(stripTransientTransferMarker(message)), "utf8");
}

function isTransferPayloadBounded(payloadBytes: number): boolean {
  return payloadBytes <= getCodexPendingInputMaxDeliveryBytes() + RECOVERY_DELIVERY_TRANSFER_METADATA_ALLOWANCE;
}

function stripTransientTransferMarker(message: RecoveryUserMessage): RecoveryUserMessage {
  const transferId = getRecoveryDeliveryTransferId(message);
  if (!transferId) return message;
  const { recoveryDeliveryTransferId: _marker, ...persisted } = message as RecoveryUserMessage & {
    recoveryDeliveryTransferId: string;
  };
  return persisted;
}

function hasPendingRecoveryOwner(
  session: RecoveryDeliveryTransferSessionLike,
  links: readonly CodexAutoPauseRecoveryLink[],
): boolean {
  const pending = [
    ...session.pendingCodexInputs.flatMap((input) => input.autoPauseRecoveries ?? []),
    ...session.pendingCodexTurns.flatMap((turn) => turn.autoPauseRecoveryLinks ?? []),
  ];
  return links.some((link) =>
    pending.some((candidate) => candidate.summaryId === link.summaryId && candidate.groupId === link.groupId),
  );
}

function detachTransferSourceOwners(session: RecoveryDeliveryTransferSessionLike): boolean {
  let changed = false;
  const autoOwnerIds = new Set(
    session.recoveryDeliveryTransfers
      .filter((entry) => entry.sourceOwnerKind === "auto_pause")
      .map((entry) => entry.sourceOwnerId),
  );
  const autoPause = session.state.codex_result_error_auto_pause;
  if (autoPause && autoOwnerIds.size > 0) {
    const retained = autoPause.heldInputs.filter((item) => !autoOwnerIds.has(item.id));
    changed ||= retained.length !== autoPause.heldInputs.length;
    if (retained.length === 0) session.state.codex_result_error_auto_pause = null;
    else autoPause.heldInputs = retained;
  }

  const manualOwnerIds = new Set(
    session.recoveryDeliveryTransfers
      .filter((entry) => entry.sourceOwnerKind === "manual_pause")
      .map((entry) => entry.sourceOwnerId),
  );
  const pause = session.state.pause;
  if (pause && manualOwnerIds.size > 0) {
    const retained = pause.queuedMessages.filter((item) => !manualOwnerIds.has(item.id));
    changed ||= retained.length !== pause.queuedMessages.length;
    if (retained.length === 0) session.state.pause = null;
    else pause.queuedMessages = retained;
  }
  return changed;
}
