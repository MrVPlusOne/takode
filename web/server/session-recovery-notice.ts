import {
  getLeaderRecycleRecoveryInstructions,
  getStandardContextRecoveryInstructions,
} from "./compaction-recovery-prompts.js";

/** Sender of the message that tells a session's agent what Takode rebuilt when it launched. */
export const SESSION_RECOVERY_SOURCE = { sessionId: "system:session-recovery", sessionLabel: "System" };

/**
 * What Takode had to rebuild for a session since its agent last ran, kept
 * until the agent is told in one message before any other input.
 */
export interface SessionRecoveryFacts {
  /** The session's worktree folder was gone, so Takode created a new checkout. */
  checkout?: CheckoutRecovery;
  /** The backend's saved conversation was gone, so the session continues in a fresh one. */
  conversationLost?: boolean;
}

export interface CheckoutRecovery {
  /** The folder that no longer existed. */
  oldCwd: string;
  /** The new checkout. */
  cwd: string;
  /** The branch the new checkout is on. */
  branch: string;
  /** The session's own branch was checked out again, so its commits are kept. */
  ownBranchKept: boolean;
  /** A fresh checkout's starting branch. */
  baseBranch?: string;
  /** A fresh checkout's predecessor: the session's own branch, which it no longer has. */
  previousBranch?: string;
  /** The recorded base branch, when it is missing here and the checkout started from the default branch instead. */
  missingBase?: { branch: string; repoRoot: string };
}

export function mergeSessionRecoveryFacts(
  earlier: SessionRecoveryFacts | undefined,
  later: SessionRecoveryFacts,
): SessionRecoveryFacts {
  const checkout = later.checkout ?? earlier?.checkout;
  return {
    ...(checkout ? { checkout } : {}),
    ...(earlier?.conversationLost || later.conversationLost ? { conversationLost: true } : {}),
  };
}

/**
 * The one message a recovered session's agent gets first: what was kept, what
 * was lost and, for a lost conversation, how to recover context from the
 * session's Takode history (the same instructions a recycled session gets).
 */
export function formatSessionRecoveryNotice(
  facts: SessionRecoveryFacts,
  role: "leader" | "standard",
  sessionRef: string,
): string {
  const parts = ["Takode had to rebuild part of this session before this launch. What was kept and what was lost:"];
  if (facts.checkout) parts.push(`- Worktree: ${describeCheckout(facts.checkout)}`);
  if (!facts.conversationLost) {
    parts.push("Check `git status` and `git log` before continuing, and redo any lost work you still need.");
    return parts.join("\n\n");
  }
  parts.push(
    "- Conversation: your previous conversation is no longer saved on this session's machine, so you continue in a fresh conversation without your earlier context. Kept: this session's history in Takode, which you can read.",
  );
  parts.push(
    role === "leader"
      ? getLeaderRecycleRecoveryInstructions(sessionRef, "its previous conversation was lost")
      : `Recover your context before acting:\n\n${getStandardContextRecoveryInstructions(sessionRef)}`,
  );
  return parts.join("\n\n");
}

function describeCheckout(checkout: CheckoutRecovery): string {
  const gone = `${checkout.oldCwd} no longer existed (it was removed, or the session's machine was replaced)`;
  const uncommitted = "uncommitted changes and untracked files that were only in the old folder";
  if (checkout.ownBranchKept) {
    return `${gone}, so Takode created ${checkout.cwd} on your branch ${checkout.branch}. Kept: the commits on ${checkout.branch}. Lost: ${uncommitted}.`;
  }
  const missing = checkout.missingBase
    ? ` (${checkout.missingBase.branch} does not exist in ${checkout.missingBase.repoRoot} on this machine)`
    : "";
  const previous = checkout.previousBranch
    ? `commits on your previous branch ${checkout.previousBranch} that are not in ${checkout.baseBranch}, and `
    : "";
  return `${gone}, so Takode created ${checkout.cwd} on a new branch ${checkout.branch}, starting from ${checkout.baseBranch}${missing}. Lost: ${previous}${uncommitted}.`;
}
