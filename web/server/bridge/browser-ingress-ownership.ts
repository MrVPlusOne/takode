import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  CodexAutoPauseRecoveryLink,
  CodexOutboundTurn,
  PendingCodexInput,
} from "../session-types.js";

export type BrowserIngressOwnershipResult =
  | { status: "accepted_pending_delivery" }
  | { status: "queued_manual_pause" }
  | { status: "reheld_auto_pause" }
  | { status: "terminal_receipt" }
  | {
      status: "terminal_rejected";
      reason: "routing_error" | "unsafe_raw_image";
      unownedRecoveryLinks?: CodexAutoPauseRecoveryLink[];
    }
  | {
      status: "ignored_no_owner";
      reason: "archived_read_only" | "protocol_handled" | "route_completed_without_owner" | "no_recovery_links";
      unownedRecoveryLinks?: CodexAutoPauseRecoveryLink[];
    };

interface RecoveryOwnershipSessionLike {
  messageHistory: BrowserIncomingMessage[];
  pendingCodexInputs: PendingCodexInput[];
  pendingCodexTurns: CodexOutboundTurn[];
}

export function classifyRecoveryDeliveryOwnership(
  session: RecoveryOwnershipSessionLike,
  msg: BrowserOutgoingMessage,
): BrowserIngressOwnershipResult {
  const links = recoveryLinks(msg);
  if (links.length === 0) return { status: "ignored_no_owner", reason: "no_recovery_links" };

  const pendingLinks = new Set(
    [
      ...session.pendingCodexInputs.flatMap((input) => input.autoPauseRecoveries ?? []),
      ...session.pendingCodexTurns.flatMap((turn) => turn.autoPauseRecoveryLinks ?? []),
    ].map(recoveryLinkKey),
  );
  const terminalLinks = new Set(
    session.messageHistory.flatMap((entry) =>
      entry.type === "codex_auto_pause_recovery_summary"
        ? entry.recovery.receipts
            .filter((receipt) => receipt.outcome !== "released_to_delivery")
            .map((receipt) => recoveryLinkKey({ summaryId: entry.id, groupId: receipt.groupId }))
        : [],
    ),
  );
  const unowned = links.filter((link) => {
    const key = recoveryLinkKey(link);
    return !pendingLinks.has(key) && !terminalLinks.has(key);
  });
  if (unowned.length > 0) {
    return { status: "ignored_no_owner", reason: "route_completed_without_owner", unownedRecoveryLinks: unowned };
  }
  return links.every((link) => terminalLinks.has(recoveryLinkKey(link)))
    ? { status: "terminal_receipt" }
    : { status: "accepted_pending_delivery" };
}

export function unownedRecoveryLinks(msg: BrowserOutgoingMessage): {
  unownedRecoveryLinks?: CodexAutoPauseRecoveryLink[];
} {
  const links = recoveryLinks(msg);
  return links.length > 0 ? { unownedRecoveryLinks: links } : {};
}

function recoveryLinks(msg: BrowserOutgoingMessage): CodexAutoPauseRecoveryLink[] {
  if (msg.type !== "user_message") return [];
  const seen = new Set<string>();
  return (msg.autoPauseRecoveries ?? []).filter((link) => {
    const key = recoveryLinkKey(link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recoveryLinkKey(link: CodexAutoPauseRecoveryLink): string {
  return `${link.summaryId}\u0000${link.groupId}`;
}
