import type { BrowserOutgoingMessage } from "../session-types.js";

export function getRecoveryDeliveryTransferId(message: BrowserOutgoingMessage): string | undefined {
  const value = (message as { recoveryDeliveryTransferId?: unknown }).recoveryDeliveryTransferId;
  return typeof value === "string" && value.startsWith("recovery-transfer-") ? value : undefined;
}
