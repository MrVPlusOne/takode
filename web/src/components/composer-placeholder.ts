const QUEST_THREAD_KEY_RE = /^q-\d+$/i;

function normalizeThreadKey(threadKey: string): string {
  return threadKey.trim().toLowerCase();
}

function isQuestThreadKey(threadKey: string): boolean {
  return QUEST_THREAD_KEY_RE.test(normalizeThreadKey(threadKey));
}

export function buildComposerPlaceholder({
  isCodex,
  isLeaderSession,
  threadKey,
  topicName,
  usesTouchKeyboard,
  isNarrowLayout,
  pendingAskUserPerm,
  pendingPlanPerm,
}: {
  isCodex: boolean;
  isLeaderSession: boolean;
  threadKey: string;
  /** A topic conversation's topic: its messages go there, so the placeholder names it on every screen. */
  topicName?: string;
  usesTouchKeyboard: boolean;
  isNarrowLayout: boolean;
  pendingAskUserPerm: unknown;
  pendingPlanPerm: unknown;
}): string {
  if (pendingAskUserPerm) return "Type your answer...";
  if (pendingPlanPerm) return "Type to reject plan and send new instructions...";

  const hintSuffix = isCodex ? "(/ for commands, $ for skills/apps, @ for files)" : "(/ for commands, @ for files)";
  const normalizedThreadKey = normalizeThreadKey(threadKey);
  const shouldShowThreadDestination =
    isLeaderSession && isQuestThreadKey(normalizedThreadKey) && !usesTouchKeyboard && !isNarrowLayout;
  const leadIn =
    isLeaderSession && topicName
      ? `Posting to ${topicName} ...`
      : shouldShowThreadDestination
        ? `Posting to ${normalizedThreadKey} ...`
        : "Type a message...";

  return `${leadIn} ${hintSuffix}`;
}
