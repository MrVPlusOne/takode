import {
  getActiveCodexResultErrorAutoPause,
  isAutomaticCodexAutoPauseInput,
  materializeCodexAutoPausedInputsForDrain,
  noteCodexResultForAutoPause,
  queueCodexAutoPausedInput,
} from "../codex-result-error-auto-pause.js";
import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  CLIResultMessage,
  CodexOutboundTurn,
  TakodeHerdBatchSnapshot,
  ThreadRef,
} from "../session-types.js";
import { buildProgrammaticUserMessage } from "../session-pause.js";
import type { Session } from "./ws-bridge-session.js";
import {
  handleBrowserIngressMessage,
  type BrowserTransportDeps,
  type ProgrammaticUserMessageOptions,
} from "./browser-transport-controller.js";

type ProgrammaticUserMessage = Extract<BrowserOutgoingMessage, { type: "user_message" }>;

interface CodexAutoPauseDeliveryDeps {
  broadcastToBrowsers: (session: Session, msg: BrowserIncomingMessage) => void;
  persistSession: (session: Session) => void;
  getBrowserTransportDeps: () => BrowserTransportDeps;
}

interface ProgrammaticCodexAutoPauseDeliveryInput {
  content: string;
  agentSource?: { sessionId: string; sessionLabel?: string };
  takodeHerdBatch?: TakodeHerdBatchSnapshot;
  threadRoute?: { threadKey: string; questId?: string; threadRefs?: ThreadRef[] };
  options?: ProgrammaticUserMessageOptions;
}

export function handleCodexResultErrorAutoPause(
  session: Session,
  msg: CLIResultMessage,
  completedTurn: CodexOutboundTurn | null,
  deps: CodexAutoPauseDeliveryDeps,
): Promise<void> | void {
  if (session.backendType !== "codex") return;
  const outcome = noteCodexResultForAutoPause(session, msg, completedTurn);
  if (!outcome.changed) return;
  broadcastCodexResultErrorAutoPauseUpdate(session, deps);
  if (outcome.diagnostic) {
    deps.broadcastToBrowsers(session, { type: "error", message: outcome.diagnostic });
  }
  deps.persistSession(session);
  if (!outcome.resumedNow || !outcome.heldInputs?.length) return;

  const messages = materializeCodexAutoPausedInputsForDrain(outcome.heldInputs);
  return drainCodexAutoPausedInputs(session, messages, deps);
}

export function prepareProgrammaticCodexAutoPauseDelivery(
  session: Session,
  input: ProgrammaticCodexAutoPauseDeliveryInput,
  deps: Pick<CodexAutoPauseDeliveryDeps, "broadcastToBrowsers" | "persistSession">,
): { status: "deliver"; options?: ProgrammaticUserMessageOptions } | { status: "held" } {
  const effectiveOptions = resolveProgrammaticAutoPauseOptions(input.options, input.agentSource);
  const autoPause = getActiveCodexResultErrorAutoPause(session);
  const message = buildProgrammaticUserMessage({
    content: input.content,
    agentSource: input.agentSource,
    takodeHerdBatch: input.takodeHerdBatch,
    threadRoute: input.threadRoute,
    options: effectiveOptions,
  });
  if (!autoPause || !isAutomaticCodexAutoPauseInput(message)) {
    return { status: "deliver", options: effectiveOptions };
  }

  queueCodexAutoPausedInput(session, "programmatic", message);
  broadcastCodexResultErrorAutoPauseUpdate(session, deps);
  deps.persistSession(session);
  return { status: "held" };
}

function resolveProgrammaticAutoPauseOptions(
  options: ProgrammaticUserMessageOptions | undefined,
  agentSource: { sessionId: string; sessionLabel?: string } | undefined,
): ProgrammaticUserMessageOptions | undefined {
  if (!options) return undefined;
  if (!agentSource && options.bypassPause && !options.autoPauseSourceKind) {
    return { ...options, autoPauseSourceKind: "manual" };
  }
  return {
    ...options,
  };
}

function broadcastCodexResultErrorAutoPauseUpdate(
  session: Session,
  deps: Pick<CodexAutoPauseDeliveryDeps, "broadcastToBrowsers">,
): void {
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { codex_result_error_auto_pause: session.state.codex_result_error_auto_pause ?? null },
  });
}

async function drainCodexAutoPausedInputs(
  session: Session,
  messages: ProgrammaticUserMessage[],
  deps: CodexAutoPauseDeliveryDeps,
): Promise<void> {
  for (const message of messages) {
    await handleBrowserIngressMessage(session, message, undefined, deps.getBrowserTransportDeps());
  }
}
