/** Compact server-owned summary used by session navigation surfaces. */
export const SESSION_NAVIGATION_PROJECTION = "session-navigation" as const;
export const SESSION_NAVIGATION_PROJECTION_MAX_VALUE_BYTES = 16 * 1024;
export const SESSION_NAVIGATION_ID_MAX_LENGTH = 160;
export const SESSION_NAVIGATION_TEXT_MAX_LENGTH = 1_024;
export const SESSION_NAVIGATION_PATH_MAX_LENGTH = 4_096;
export const SESSION_NAVIGATION_PREVIEW_MAX_LENGTH = 80;

const RULES = {
  name: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  model: ["string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  cwd: ["string", SESSION_NAVIGATION_PATH_MAX_LENGTH],
  backendType: ["claude", "codex", "claude-sdk"],
  permissionMode: ["string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  askPermission: "boolean",
  sessionNum: "positive-nullable-integer",
  createdAt: "nonnegative-number",
  treeGroupId: ["nullable-string", SESSION_NAVIGATION_ID_MAX_LENGTH],
  memorySessionSpaceSlug: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  repoRoot: ["string", SESSION_NAVIGATION_PATH_MAX_LENGTH],
  isWorktree: "boolean",
  isContainerized: "boolean",
  isAssistant: "boolean",
  isOrchestrator: "boolean",
  herdedBy: ["nullable-string", SESSION_NAVIGATION_ID_MAX_LENGTH],
  reviewerOf: "positive-nullable-integer",
  cronJobId: ["nullable-string", SESSION_NAVIGATION_ID_MAX_LENGTH],
  cronJobName: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  state: ["starting", "connected", "running", "exited"],
  status: ["running", "compacting", "reverting", "idle", null],
  cliConnected: "boolean",
  killedByIdleManager: "boolean",
  pendingPermissionCount: "nonnegative-integer",
  pendingTimerCount: "nonnegative-integer",
  paused: "boolean",
  pausedInputQueueCount: "nonnegative-integer",
  lastActivityAt: "nonnegative-nullable-number",
  lastUserMessageAt: "nonnegative-nullable-number",
  lastMessagePreviewAt: "nonnegative-nullable-number",
  claimedQuestId: ["nullable-string", SESSION_NAVIGATION_ID_MAX_LENGTH],
  claimedQuestTitle: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  claimedQuestStatus: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  claimedQuestVerificationInboxUnread: "nullable-boolean",
  claimedQuestLeaderSessionId: ["nullable-string", SESSION_NAVIGATION_ID_MAX_LENGTH],
  gitBranch: ["string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  gitDefaultBranch: ["string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  diffBaseBranch: ["string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  gitAhead: "nonnegative-integer",
  gitBehind: "nonnegative-integer",
  totalLinesAdded: "nonnegative-integer",
  totalLinesRemoved: "nonnegative-integer",
  diffStatsSkippedReason: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  gitStatusRefreshedAt: "nonnegative-nullable-number",
  gitStatusRefreshError: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  lastMessagePreview: ["string", SESSION_NAVIGATION_PREVIEW_MAX_LENGTH],
  userTurnCount: "nonnegative-integer",
  agentTurnCount: "nonnegative-integer",
  contextUsedPercent: "nonnegative-number",
  contextTokensUsed: "nonnegative-nullable-number",
  modelContextWindow: "nonnegative-nullable-number",
  codexMaxContextLength: "nonnegative-nullable-number",
  claudeMaxContextLength: "nonnegative-nullable-number",
  codexLeaderRecycleThresholdTokens: "nonnegative-nullable-number",
  messageHistoryBytes: "nonnegative-integer",
  codexRetainedPayloadBytes: "nonnegative-integer",
  codexReasoningEffort: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  codexEffectiveReasoningEffort: ["nullable-string", SESSION_NAVIGATION_TEXT_MAX_LENGTH],
  codexEffectiveReasoningEffortReported: "boolean",
} as const;

type FieldRule = (typeof RULES)[keyof typeof RULES];
type FieldValue<Rule extends FieldRule> = Rule extends "boolean"
  ? boolean
  : Rule extends "nullable-boolean"
    ? boolean | null
    : Rule extends "nonnegative-integer" | "nonnegative-number"
      ? number
      : Rule extends "nonnegative-nullable-number" | "positive-nullable-integer"
        ? number | null
        : Rule extends readonly ["string", number]
          ? string
          : Rule extends readonly ["nullable-string", number]
            ? string | null
            : Rule extends readonly unknown[]
              ? Rule[number]
              : never;

/** Current-build fields shared by REST session rows and live projection updates. */
export type SessionNavigationProjectionValue = {
  -readonly [Field in keyof typeof RULES]: FieldValue<(typeof RULES)[Field]>;
};
export type SessionNavigationBackendType = SessionNavigationProjectionValue["backendType"];
export type SessionNavigationSdkState = SessionNavigationProjectionValue["state"];
export type SessionNavigationStatus = SessionNavigationProjectionValue["status"];
export type SessionNavigationProjectionPatch = Partial<SessionNavigationProjectionValue>;

function fieldMatches(rule: FieldRule, value: unknown): boolean {
  if (rule === "boolean") return typeof value === "boolean";
  if (rule === "nullable-boolean") return value === null || typeof value === "boolean";
  if (rule === "nonnegative-integer") return Number.isSafeInteger(value) && (value as number) >= 0;
  if (rule === "positive-nullable-integer")
    return value === null || (Number.isSafeInteger(value) && (value as number) >= 1);
  if (rule === "nonnegative-number") return typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (rule === "nonnegative-nullable-number") {
    return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
  }
  if (rule[0] === "string" || rule[0] === "nullable-string") {
    return (
      (rule[0] === "nullable-string" && value === null) ||
      (typeof value === "string" && value.length <= (rule[1] as number))
    );
  }
  return (rule as readonly unknown[]).includes(value);
}

export function isSessionNavigationProjectionValue(value: unknown): value is SessionNavigationProjectionValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const fields = Object.keys(RULES) as (keyof SessionNavigationProjectionValue)[];
  return (
    Object.keys(candidate).length === fields.length &&
    fields.every((field) => fieldMatches(RULES[field], candidate[field]))
  );
}

export function sessionNavigationProjectionEqual(
  left: SessionNavigationProjectionValue,
  right: SessionNavigationProjectionValue,
): boolean {
  return (Object.keys(RULES) as (keyof SessionNavigationProjectionValue)[]).every(
    (field) => left[field] === right[field],
  );
}

export function reconcileSessionNavigationProjectionValue(
  previous: SessionNavigationProjectionValue | undefined,
  next: SessionNavigationProjectionValue,
): SessionNavigationProjectionValue {
  return previous && sessionNavigationProjectionEqual(previous, next) ? previous : next;
}

/** Convert explicit projection clears to the optional session-list field shape. */
export function sessionNavigationProjectionToSessionFields(value: SessionNavigationProjectionValue) {
  return {
    ...value,
    name: value.name ?? undefined,
    herdedBy: value.herdedBy ?? undefined,
    reviewerOf: value.reviewerOf ?? undefined,
    cronJobId: value.cronJobId ?? undefined,
    cronJobName: value.cronJobName ?? undefined,
    lastActivityAt: value.lastActivityAt ?? undefined,
    lastUserMessageAt: value.lastUserMessageAt ?? undefined,
    lastMessagePreviewAt: value.lastMessagePreviewAt ?? undefined,
    gitStatusRefreshedAt: value.gitStatusRefreshedAt ?? undefined,
    codexLeaderRecycleThresholdTokens: value.codexLeaderRecycleThresholdTokens ?? undefined,
    claimedQuestVerificationInboxUnread: value.claimedQuestVerificationInboxUnread ?? undefined,
    numTurns: value.userTurnCount,
  };
}

/** Copy only navigation-owned row fields without granting source completeness. */
export function sessionNavigationFieldsFromSession(source: Record<string, unknown>) {
  return Object.fromEntries(
    [...Object.keys(RULES), "numTurns"]
      .filter((field) => Object.hasOwn(source, field))
      .map((field) => [field, source[field]]),
  );
}

export function createSessionNavigationProjectionPatch(
  previous: SessionNavigationProjectionValue,
  next: SessionNavigationProjectionValue,
): SessionNavigationProjectionPatch {
  return Object.fromEntries(
    (Object.keys(RULES) as (keyof SessionNavigationProjectionValue)[])
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, next[field]]),
  ) as SessionNavigationProjectionPatch;
}

export function applySessionNavigationProjectionPatch(
  previous: SessionNavigationProjectionValue,
  input: unknown,
): SessionNavigationProjectionValue | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const patch = input as Record<string, unknown>;
  if (Object.keys(patch).some((field) => !Object.hasOwn(RULES, field))) return undefined;
  const next = { ...previous, ...patch };
  return isSessionNavigationProjectionValue(next)
    ? reconcileSessionNavigationProjectionValue(previous, next)
    : undefined;
}
