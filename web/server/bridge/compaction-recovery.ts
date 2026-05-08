import type { BrowserIncomingMessage } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import { getKnownSessionNum } from "../cli-launcher.js";
import { getCompactionRecoveryPrompt, isCompactionRecoveryPrompt } from "../compaction-recovery-prompts.js";
import {
  COMPACTION_RECOVERY_SOURCE_ID,
  COMPACTION_RECOVERY_SOURCE_LABEL,
} from "../../shared/injected-event-message.js";

export {
  LEGACY_LEADER_COMPACTION_RECOVERY_PROMPT,
  LEGACY_STANDARD_COMPACTION_RECOVERY_PROMPT,
  getCompactionRecoveryPrompt,
  isCompactionRecoveryPrompt,
} from "../compaction-recovery-prompts.js";

/** Extract structured Q&A pairs from an AskUserQuestion approval. */
export function extractAskUserAnswers(
  originalInput: Record<string, unknown>,
  updatedInput?: Record<string, unknown>,
): { question: string; answer: string }[] | undefined {
  const answers = updatedInput?.answers as Record<string, string> | undefined;
  const questions = Array.isArray(originalInput.questions)
    ? (originalInput.questions as Record<string, unknown>[])
    : [];
  if (!answers || !questions.length) return undefined;

  const pairs: { question: string; answer: string }[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const questionText = typeof q.question === "string" ? q.question : "";
    const answer = answers[String(i)] ?? (questionText ? answers[questionText] : undefined);
    if (questionText && answer) {
      pairs.push({ question: questionText, answer });
    }
  }
  return pairs.length ? pairs : undefined;
}

type CompactionRecoverySessionLike = {
  id: string;
  sessionNum?: number | null;
  messageHistory: BrowserIncomingMessage[];
};

export function hasCompactionRecoveryAfterLatestMarker(
  session: CompactionRecoverySessionLike,
  deps: { isSystemSourceTag: (agentSource: { sessionId: string; sessionLabel?: string } | undefined) => boolean },
): boolean {
  let latestCompactIdx = -1;
  for (let i = session.messageHistory.length - 1; i >= 0; i--) {
    if (session.messageHistory[i]?.type === "compact_marker") {
      latestCompactIdx = i;
      break;
    }
  }
  if (latestCompactIdx < 0) return false;

  for (let i = latestCompactIdx + 1; i < session.messageHistory.length; i++) {
    const entry = session.messageHistory[i] as
      | {
          type?: string;
          content?: string;
          agentSource?: { sessionId: string; sessionLabel?: string };
        }
      | undefined;
    if (entry?.type !== "user_message") continue;
    if (typeof entry.content !== "string" || !isCompactionRecoveryPrompt(entry.content)) continue;
    if (!deps.isSystemSourceTag(entry.agentSource)) continue;
    return true;
  }
  return false;
}

export function injectCompactionRecovery(
  session: CompactionRecoverySessionLike,
  deps: {
    isLeaderSession: (session: CompactionRecoverySessionLike) => boolean;
    isSystemSourceTag: (agentSource: { sessionId: string; sessionLabel?: string } | undefined) => boolean;
    injectUserMessage: (
      sessionId: string,
      content: string,
      agentSource?: { sessionId: string; sessionLabel?: string },
    ) => void;
  },
): void {
  if (hasCompactionRecoveryAfterLatestMarker(session, deps)) return;
  const role = deps.isLeaderSession(session) ? "leader" : "standard";
  const sessionRef = String(getKnownSessionNum(session.id) ?? session.sessionNum ?? session.id);
  const prompt = getCompactionRecoveryPrompt(role, sessionRef);
  console.log(`[ws-bridge] Injecting ${role} compaction recovery for session ${sessionTag(session.id)}`);
  deps.injectUserMessage(session.id, prompt, {
    sessionId: COMPACTION_RECOVERY_SOURCE_ID,
    sessionLabel: COMPACTION_RECOVERY_SOURCE_LABEL,
  });
}
