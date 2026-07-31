import { AsyncLocalStorage } from "node:async_hooks";
import type { BrowserOutgoingMessage } from "../session-types.js";
import type { RecoveryDeliveryTransfer } from "./recovery-delivery-transfer.js";

interface TrustedRecoveryDeliveryTransferContext {
  sessionId: string;
  transferId: string;
  recoveryLinks: string;
  payloadJson: string;
}

const trustedTransferRoute = new AsyncLocalStorage<TrustedRecoveryDeliveryTransferContext>();

export function withTrustedRecoveryDeliveryTransferRoute<T>(
  session: { id: string },
  transfer: RecoveryDeliveryTransfer,
  task: () => T,
): T {
  return trustedTransferRoute.run(
    {
      sessionId: session.id,
      transferId: transfer.id,
      recoveryLinks: recoveryLinkIdentity(transfer.message),
      payloadJson: transferPayloadJson(transfer.message),
    },
    task,
  );
}

export function getTrustedRecoveryDeliveryTransferId(
  session: { id: string; recoveryDeliveryTransfers?: RecoveryDeliveryTransfer[] },
  message: BrowserOutgoingMessage,
): string | undefined {
  const context = trustedTransferRoute.getStore();
  if (!context || context.sessionId !== session.id) return undefined;
  const transfer = session.recoveryDeliveryTransfers?.find((entry) => entry.id === context.transferId);
  if (!transfer) return undefined;
  if (recoveryLinkIdentity(transfer.message) !== context.recoveryLinks) return undefined;
  if (recoveryLinkIdentity(message) !== context.recoveryLinks) return undefined;
  if (transferPayloadJson(transfer.message) !== context.payloadJson) return undefined;
  if (transferPayloadJson(message) !== context.payloadJson) return undefined;
  return transfer.id;
}

export function stripRecoveryDeliveryTransferMarker(message: BrowserOutgoingMessage): BrowserOutgoingMessage {
  if (!("recoveryDeliveryTransferId" in message)) return message;
  const { recoveryDeliveryTransferId: _marker, ...clean } = message as BrowserOutgoingMessage & {
    recoveryDeliveryTransferId?: unknown;
  };
  return clean as BrowserOutgoingMessage;
}

function recoveryLinkIdentity(message: BrowserOutgoingMessage): string {
  if (message.type !== "user_message") return "";
  return [...(message.autoPauseRecoveries ?? [])]
    .map((link) => `${link.summaryId}\u0000${link.groupId}`)
    .sort()
    .join("\u0001");
}

function transferPayloadJson(message: BrowserOutgoingMessage): string {
  return JSON.stringify(stripRecoveryDeliveryTransferMarker(message));
}
