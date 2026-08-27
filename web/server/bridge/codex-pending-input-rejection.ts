import { compactRejectedCodexInputForBrowser } from "../codex-pending-input-safety.js";
import type { CodexAutoPauseRecoveryLink, PendingCodexInput } from "../session-types.js";
import { markCodexAutoPauseRecoveryFailed } from "./codex-auto-pause-recovery-summary.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";

export function rejectOversizedCodexPendingInput(
  session: AdapterBrowserRoutingSessionLike,
  input: PendingCodexInput,
  recoveryLinks: CodexAutoPauseRecoveryLink[],
  size: { actualBytes: number; maxBytes: number },
  ws: unknown,
  deps: Pick<AdapterBrowserRoutingDeps, "broadcastToBrowsers" | "persistSession" | "sendToBrowser">,
): void {
  const message =
    `Codex input is too large to queue safely (${size.actualBytes} bytes; limit ${size.maxBytes}). ` +
    "The message was not sent to Codex.";
  markCodexAutoPauseRecoveryFailed(session, recoveryLinks, Date.now(), deps, "pending_input_too_large");
  if (ws && input.clientMsgId) {
    deps.sendToBrowser(ws, {
      type: "codex_pending_input_failed",
      input: compactRejectedCodexInputForBrowser(input),
      reason: "pending_input_too_large",
      message,
    });
  }
  deps.broadcastToBrowsers(session, { type: "error", message });
  deps.persistSession(session);
}
