import {
  injectUserMessage,
  type BrowserTransportDeps,
  type ProgrammaticUserMessageOptions,
} from "./browser-transport-controller.js";
import { prepareProgrammaticCodexAutoPauseDelivery } from "./codex-result-error-auto-pause-delivery.js";
import type { BrowserIncomingMessage, TakodeHerdBatchSnapshot, ThreadRef } from "../session-types.js";
import { buildProgrammaticUserMessage, isSessionPaused, queuePausedUserMessage } from "../session-pause.js";
import type { Session } from "./ws-bridge-session.js";

export type ProgrammaticUserMessageDeliveryStatus = "sent" | "queued" | "paused_queued" | "dropped";

interface ProgrammaticUserMessageDeliveryDeps {
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  persistSession: (session: Session) => void;
  getBrowserTransportDeps: () => BrowserTransportDeps;
  pruneStaleBoardStalledHerdBatch: (
    session: Session,
    batch: TakodeHerdBatchSnapshot | undefined,
  ) => { batch?: TakodeHerdBatchSnapshot; content?: string; changed: boolean };
  syncBackendTypeFromLauncher: (session: Session, reason: string) => void;
}

export function deliverProgrammaticUserMessage(
  session: Session,
  content: string,
  agentSource: { sessionId: string; sessionLabel?: string } | undefined,
  takodeHerdBatch: TakodeHerdBatchSnapshot | undefined,
  threadRoute: { threadKey: string; questId?: string; threadRefs?: ThreadRef[] } | undefined,
  options: ProgrammaticUserMessageOptions | undefined,
  deps: ProgrammaticUserMessageDeliveryDeps,
): ProgrammaticUserMessageDeliveryStatus {
  let deliveryContent = content;
  let deliveryBatch = takodeHerdBatch;
  if (agentSource?.sessionId === "herd-events" && deliveryBatch) {
    const pruned = deps.pruneStaleBoardStalledHerdBatch(session, deliveryBatch);
    if (pruned.changed) {
      if (!pruned.content || !pruned.batch) return "dropped";
      deliveryContent = pruned.content;
      deliveryBatch = pruned.batch;
    }
  }

  if (isSessionPaused(session) && !options?.bypassPause) {
    const message = buildProgrammaticUserMessage({
      content: deliveryContent,
      agentSource,
      takodeHerdBatch: deliveryBatch,
      threadRoute,
      options,
    });
    queuePausedUserMessage(session, "programmatic", message);
    deps.broadcastToBrowsers(session, { type: "session_update", session: { pause: session.state.pause } });
    deps.persistSession(session);
    return "paused_queued";
  }

  const autoPauseDelivery = prepareProgrammaticCodexAutoPauseDelivery(
    session,
    {
      content: deliveryContent,
      agentSource,
      takodeHerdBatch: deliveryBatch,
      threadRoute,
      options,
    },
    deps,
  );
  if (autoPauseDelivery.status === "held") return "paused_queued";

  deps.syncBackendTypeFromLauncher(session, "inject_user_message");
  return injectUserMessage(
    session,
    deliveryContent,
    agentSource,
    deliveryBatch,
    deps.getBrowserTransportDeps(),
    threadRoute,
    autoPauseDelivery.options,
  );
}
