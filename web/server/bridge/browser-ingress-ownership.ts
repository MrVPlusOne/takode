import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  CodexAutoPauseRecoveryLink,
  CodexOutboundTurn,
  PendingCodexInput,
  SessionState,
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

export type RecoveryIngressOwnershipResolution =
  | { status: "not_recovery_message" }
  | { status: "owned" }
  | { status: "unowned"; links: CodexAutoPauseRecoveryLink[] };

interface RecoveryOwnershipSessionLike {
  messageHistory: BrowserIncomingMessage[];
  pendingCodexInputs: PendingCodexInput[];
  pendingCodexTurns: CodexOutboundTurn[];
  state: Pick<SessionState, "pause" | "codex_result_error_auto_pause">;
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
  const manualPauseLinks = new Set(
    (session.state.pause?.queuedMessages ?? [])
      .flatMap((queued) => queued.message.autoPauseRecoveries ?? [])
      .map(recoveryLinkKey),
  );
  const renewedAutoPauseLinks = new Set(
    (session.state.codex_result_error_auto_pause?.heldInputs ?? [])
      .flatMap((held) => held.message.autoPauseRecoveries ?? [])
      .map(recoveryLinkKey),
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
    return (
      !pendingLinks.has(key) && !manualPauseLinks.has(key) && !renewedAutoPauseLinks.has(key) && !terminalLinks.has(key)
    );
  });
  if (unowned.length > 0) {
    return { status: "ignored_no_owner", reason: "route_completed_without_owner", unownedRecoveryLinks: unowned };
  }
  return links.every((link) => terminalLinks.has(recoveryLinkKey(link)))
    ? { status: "terminal_receipt" }
    : links.some((link) => pendingLinks.has(recoveryLinkKey(link)))
      ? { status: "accepted_pending_delivery" }
      : links.some((link) => manualPauseLinks.has(recoveryLinkKey(link)))
        ? { status: "queued_manual_pause" }
        : { status: "reheld_auto_pause" };
}

export function unownedRecoveryLinks(msg: BrowserOutgoingMessage): {
  unownedRecoveryLinks?: CodexAutoPauseRecoveryLink[];
} {
  const links = recoveryLinks(msg);
  return links.length > 0 ? { unownedRecoveryLinks: links } : {};
}

export function resolveRecoveryIngressOwnership(
  admission: BrowserIngressOwnershipResult,
  msg: BrowserOutgoingMessage,
): RecoveryIngressOwnershipResolution {
  const links = recoveryLinks(msg);
  if (links.length === 0) return { status: "not_recovery_message" };
  if (
    admission.status === "accepted_pending_delivery" ||
    admission.status === "queued_manual_pause" ||
    admission.status === "reheld_auto_pause" ||
    admission.status === "terminal_receipt"
  ) {
    return { status: "owned" };
  }
  const unowned = admission.unownedRecoveryLinks?.length ? admission.unownedRecoveryLinks : links;
  return { status: "unowned", links: unowned };
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
