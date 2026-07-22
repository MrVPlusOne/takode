import type {
  BrowserIncomingMessage,
  CodexLeaderRecycleContinuation,
  ProgrammaticHistoryFollowUp,
} from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import { getKnownSessionNum } from "../cli-launcher.js";
import { getCompactionRecoveryPrompt, isCompactionRecoveryPrompt } from "../compaction-recovery-prompts.js";
import {
  buildLeaderPreloadDeliveryContent,
  buildLeaderSkillPreloadHistoryFollowUps,
  type LeaderSkillPreloadBundle,
} from "../leader-skill-preload.js";
import {
  COMPACTION_RECOVERY_SOURCE_ID,
  COMPACTION_RECOVERY_SOURCE_LABEL,
} from "../../shared/injected-event-message.js";
import {
  buildMemoryCatalogDeliveryContent,
  buildMemoryCatalogHistoryFollowUp,
  type MemoryCatalogInjectionBundle,
} from "../memory-catalog-injection-utils.js";

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
  state?: { memorySessionSpaceSlug?: string };
  messageHistory: BrowserIncomingMessage[];
  codexLeaderRecycleContinuation?: CodexLeaderRecycleContinuation | null;
};

type MemoryCatalogBuilder = (
  session: CompactionRecoverySessionLike,
) => MemoryCatalogInjectionBundle | null | undefined | Promise<MemoryCatalogInjectionBundle | null | undefined>;

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
    const latestMarker = session.messageHistory[latestCompactIdx];
    const entry = session.messageHistory[i] as
      | {
          type?: string;
          content?: string;
          agentSource?: { sessionId: string; sessionLabel?: string };
        }
      | undefined;
    if (entry?.type !== "user_message") continue;
    if (!deps.isSystemSourceTag(entry.agentSource)) continue;
    if (latestMarker?.type === "compact_marker" && latestMarker.markerKind === "session_recycled") return true;
    if (typeof entry.content !== "string" || !isCompactionRecoveryPrompt(entry.content)) continue;
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
      threadRoute?: { threadKey: string; questId?: string },
      options?: {
        deliveryContent?: string;
        historyFollowUps?: ProgrammaticHistoryFollowUp[];
      },
    ) => void;
    buildLeaderSkillPreloadBundles?: () => LeaderSkillPreloadBundle[] | Promise<LeaderSkillPreloadBundle[]>;
    buildMemoryCatalogInjectionBundle?: MemoryCatalogBuilder;
  },
): void {
  const recycleContinuation = session.codexLeaderRecycleContinuation;
  if (recycleContinuation?.content) {
    session.codexLeaderRecycleContinuation = null;
    console.log(`[ws-bridge] Injecting leader recycle continuation for session ${sessionTag(session.id)}`);
    injectWithOptionalLeaderSkillPreloads(
      session,
      recycleContinuation.content,
      buildRecycleContinuationThreadRoute(recycleContinuation),
      deps,
    );
    return;
  }
  if (hasCompactionRecoveryAfterLatestMarker(session, deps)) return;
  const role = deps.isLeaderSession(session) ? "leader" : "standard";
  const sessionRef = String(getKnownSessionNum(session.id) ?? session.sessionNum ?? session.id);
  const prompt = getCompactionRecoveryPrompt(role, sessionRef);
  console.log(`[ws-bridge] Injecting ${role} compaction recovery for session ${sessionTag(session.id)}`);
  if (role === "leader") {
    injectWithOptionalLeaderSkillPreloads(session, prompt, undefined, deps);
  } else {
    injectWithOptionalMemoryCatalog(session, prompt, undefined, deps);
  }
}

function injectWithOptionalLeaderSkillPreloads(
  session: CompactionRecoverySessionLike,
  content: string,
  threadRoute:
    | {
        threadKey: string;
        questId?: string;
      }
    | undefined,
  deps: {
    injectUserMessage: (
      sessionId: string,
      content: string,
      agentSource?: { sessionId: string; sessionLabel?: string },
      threadRoute?: { threadKey: string; questId?: string },
      options?: {
        deliveryContent?: string;
        historyFollowUps?: ProgrammaticHistoryFollowUp[];
      },
    ) => void;
    buildLeaderSkillPreloadBundles?: () => LeaderSkillPreloadBundle[] | Promise<LeaderSkillPreloadBundle[]>;
    buildMemoryCatalogInjectionBundle?: MemoryCatalogBuilder;
  },
): void {
  const source = {
    sessionId: COMPACTION_RECOVERY_SOURCE_ID,
    sessionLabel: COMPACTION_RECOVERY_SOURCE_LABEL,
  };
  const inject = (bundles: LeaderSkillPreloadBundle[], memoryCatalog?: MemoryCatalogInjectionBundle | null) => {
    const deliveryWithLeaderPreloads = buildLeaderPreloadDeliveryContent(content, bundles);
    deps.injectUserMessage(session.id, content, source, threadRoute, {
      deliveryContent: buildMemoryCatalogDeliveryContent(deliveryWithLeaderPreloads, memoryCatalog),
      historyFollowUps: [
        ...buildLeaderSkillPreloadHistoryFollowUps(bundles),
        ...buildMemoryCatalogHistoryFollowUp(memoryCatalog),
      ],
    });
  };
  try {
    const leaderBundles = deps.buildLeaderSkillPreloadBundles?.() ?? [];
    const memoryCatalog = buildOptionalMemoryCatalog(session, deps);
    if (isThenable(leaderBundles) || isThenable(memoryCatalog)) {
      void Promise.all([Promise.resolve(leaderBundles), Promise.resolve(memoryCatalog)])
        .then(([bundles, catalog]) => inject(bundles, catalog))
        .catch((err) => {
          console.error(`[ws-bridge] Failed to build leader skill preload recovery context:`, err);
          inject([], null);
        });
    } else {
      inject(leaderBundles, memoryCatalog);
    }
  } catch (err) {
    console.error(`[ws-bridge] Failed to build leader skill preload recovery context:`, err);
    inject([], null);
  }
}

function injectWithOptionalMemoryCatalog(
  session: CompactionRecoverySessionLike,
  content: string,
  threadRoute:
    | {
        threadKey: string;
        questId?: string;
      }
    | undefined,
  deps: {
    injectUserMessage: (
      sessionId: string,
      content: string,
      agentSource?: { sessionId: string; sessionLabel?: string },
      threadRoute?: { threadKey: string; questId?: string },
      options?: {
        deliveryContent?: string;
        historyFollowUps?: ProgrammaticHistoryFollowUp[];
      },
    ) => void;
    buildMemoryCatalogInjectionBundle?: MemoryCatalogBuilder;
  },
): void {
  const source = {
    sessionId: COMPACTION_RECOVERY_SOURCE_ID,
    sessionLabel: COMPACTION_RECOVERY_SOURCE_LABEL,
  };
  const inject = (memoryCatalog?: MemoryCatalogInjectionBundle | null) => {
    deps.injectUserMessage(session.id, content, source, threadRoute, {
      deliveryContent: buildMemoryCatalogDeliveryContent(content, memoryCatalog),
      historyFollowUps: buildMemoryCatalogHistoryFollowUp(memoryCatalog),
    });
  };
  try {
    const memoryCatalog = buildOptionalMemoryCatalog(session, deps);
    if (isThenable(memoryCatalog)) {
      void memoryCatalog.then(inject).catch((err) => {
        console.error(`[ws-bridge] Failed to build memory catalog recovery context:`, err);
        inject(null);
      });
    } else {
      inject(memoryCatalog);
    }
  } catch (err) {
    console.error(`[ws-bridge] Failed to build memory catalog recovery context:`, err);
    inject(null);
  }
}

function buildOptionalMemoryCatalog(
  session: CompactionRecoverySessionLike,
  deps: { buildMemoryCatalogInjectionBundle?: MemoryCatalogBuilder },
): MemoryCatalogInjectionBundle | null | undefined | Promise<MemoryCatalogInjectionBundle | null | undefined> {
  return deps.buildMemoryCatalogInjectionBundle?.(session);
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown }).then === "function";
}

function buildRecycleContinuationThreadRoute(
  continuation: CodexLeaderRecycleContinuation,
): { threadKey: string; questId?: string } | undefined {
  if (!continuation.threadKey) return undefined;
  return {
    threadKey: continuation.threadKey,
    ...(continuation.questId ? { questId: continuation.questId } : {}),
  };
}
