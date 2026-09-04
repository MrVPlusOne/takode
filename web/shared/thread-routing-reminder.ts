export const THREAD_ROUTING_REMINDER_SOURCE_ID = "system:thread-routing-reminder";
export const THREAD_ROUTING_REMINDER_SOURCE_LABEL = "Thread Routing Reminder";
export const THREAD_ROUTING_REMINDER_HEADER = "[Thread routing reminder]";

export type ThreadRoutingReminderReason =
  | "missing"
  | "invalid"
  | "missing_role"
  | "invalid_role"
  | "invalid_answer_route";
export type ThreadRoutingReminderSource = "visible_text" | "shell_command" | "answer_marker";

export type LeaderAnswerRouteDiagnosticReason =
  | "invalid_answer"
  | "invalid_ids"
  | "unproven_owner"
  | "multiple_owners"
  | "nonconsecutive_ids"
  | "missing_association"
  | "disallowed_main_backfill"
  | "route_control_conflict"
  | "stale";

export interface LeaderAnswerRouteOwnerGroup {
  threadKey: string;
  userMessageIds: string[];
}

/** Persisted fail-closed evidence for a syntactically valid answer marker. */
export interface LeaderAnswerRouteDiagnostic {
  reason: LeaderAnswerRouteDiagnosticReason;
  selectedThreadKey: string;
  answerUserMessageIds: string[];
  ownerGroups: LeaderAnswerRouteOwnerGroup[];
  missingAssociationUserMessageIds?: string[];
}

export interface ThreadRoutingReminderInput {
  reason: ThreadRoutingReminderReason;
  source?: ThreadRoutingReminderSource;
  marker?: string;
  answerRouteDiagnostic?: LeaderAnswerRouteDiagnostic;
}

const THREAD_KEY_RE = /^(?:main|q-\d+)$/;
const USER_MESSAGE_ID_RE = /^u[1-9]\d*$/;
const ANSWER_ROUTE_DIAGNOSTIC_REASONS = new Set<LeaderAnswerRouteDiagnosticReason>([
  "invalid_answer",
  "invalid_ids",
  "unproven_owner",
  "multiple_owners",
  "nonconsecutive_ids",
  "missing_association",
  "disallowed_main_backfill",
  "route_control_conflict",
  "stale",
]);

function validUniqueUserMessageIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => typeof id === "string" && USER_MESSAGE_ID_RE.test(id)) &&
    new Set(value).size === value.length
  );
}

export function isLeaderAnswerRouteDiagnostic(value: unknown): value is LeaderAnswerRouteDiagnostic {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Partial<LeaderAnswerRouteDiagnostic>;
  if (
    !ANSWER_ROUTE_DIAGNOSTIC_REASONS.has(diagnostic.reason as LeaderAnswerRouteDiagnosticReason) ||
    typeof diagnostic.selectedThreadKey !== "string" ||
    !THREAD_KEY_RE.test(diagnostic.selectedThreadKey) ||
    !validUniqueUserMessageIds(diagnostic.answerUserMessageIds) ||
    !Array.isArray(diagnostic.ownerGroups)
  ) {
    return false;
  }

  const answerIds = new Set(diagnostic.answerUserMessageIds);
  const answerIdPositions = new Map(diagnostic.answerUserMessageIds.map((id, index) => [id, index]));
  const ownerThreads = new Set<string>();
  const ownedIds = new Set<string>();
  for (const group of diagnostic.ownerGroups) {
    if (
      !group ||
      typeof group !== "object" ||
      typeof group.threadKey !== "string" ||
      !THREAD_KEY_RE.test(group.threadKey) ||
      ownerThreads.has(group.threadKey) ||
      !validUniqueUserMessageIds(group.userMessageIds) ||
      group.userMessageIds.some((id) => !answerIds.has(id) || ownedIds.has(id)) ||
      group.userMessageIds.some(
        (id, index) =>
          index > 0 && answerIdPositions.get(id)! <= answerIdPositions.get(group.userMessageIds[index - 1]!)!,
      )
    ) {
      return false;
    }
    ownerThreads.add(group.threadKey);
    group.userMessageIds.forEach((id) => ownedIds.add(id));
  }

  // A non-empty owner map is only trustworthy when it accounts for the entire
  // grouped answer. Partial maps must not make one fragment look independently
  // correctable, because the stored prose is indivisible.
  if (diagnostic.ownerGroups.length > 0 && ownedIds.size !== answerIds.size) return false;
  const soleOwner = diagnostic.ownerGroups.length === 1 ? diagnostic.ownerGroups[0]! : null;
  if (diagnostic.reason === "multiple_owners" && diagnostic.ownerGroups.length < 2) return false;
  if (
    diagnostic.reason === "disallowed_main_backfill" &&
    (diagnostic.selectedThreadKey !== "main" || !soleOwner || soleOwner.threadKey === "main")
  ) {
    return false;
  }
  if (diagnostic.reason === "missing_association") {
    if (!soleOwner || soleOwner.threadKey === diagnostic.selectedThreadKey) return false;
    if (!validUniqueUserMessageIds(diagnostic.missingAssociationUserMessageIds)) return false;
    if (
      diagnostic.missingAssociationUserMessageIds.some((id) => !answerIds.has(id)) ||
      diagnostic.missingAssociationUserMessageIds.some(
        (id, index) =>
          index > 0 &&
          answerIdPositions.get(id)! <=
            answerIdPositions.get(diagnostic.missingAssociationUserMessageIds![index - 1]!)!,
      )
    ) {
      return false;
    }
  } else if (diagnostic.missingAssociationUserMessageIds !== undefined) {
    return false;
  }
  return true;
}

export function formatThreadRoutingReminderReason(input: ThreadRoutingReminderInput): string {
  if (input.reason === "invalid_answer_route") return "Invalid answer route";
  if (input.reason === "missing_role") return "Missing commentary/answer role";
  if (input.reason === "invalid_role") {
    return input.marker ? `Invalid commentary/answer role: ${input.marker}` : "Invalid commentary/answer role";
  }
  if (input.reason === "invalid") {
    return input.marker ? `Invalid marker: ${input.marker}` : "Invalid thread marker";
  }
  return "Missing thread marker";
}

function formatThreadLabel(threadKey: string): string {
  return threadKey === "main" ? "Main" : threadKey;
}

function formatAnswerRouteFailure(diagnostic: LeaderAnswerRouteDiagnostic): string {
  const ids = diagnostic.answerUserMessageIds.join(",");
  switch (diagnostic.reason) {
    case "invalid_answer":
      return `The row is not eligible to become answer authority because its answer metadata or message shape is invalid: ${ids}.`;
    case "invalid_ids":
      return `The listed IDs are unknown, unavailable at the observed history boundary, or otherwise invalid: ${ids}.`;
    case "unproven_owner":
      return `Takode could not prove one current owner for the listed IDs: ${ids}.`;
    case "multiple_owners":
      return `The listed IDs span multiple owner threads: ${diagnostic.ownerGroups
        .map((group) => `${formatThreadLabel(group.threadKey)} (${group.userMessageIds.join(",")})`)
        .join("; ")}.`;
    case "nonconsecutive_ids":
      return `The listed IDs are not one consecutive owner-thread sequence: ${ids}.`;
    case "missing_association":
      return `${formatThreadLabel(diagnostic.selectedThreadKey)} is not visibility-associated with every referenced prompt; missing: ${diagnostic.missingAssociationUserMessageIds!.join(",")}.`;
    case "disallowed_main_backfill":
      return `Main cannot be used as a visibility-only destination for quest-owned prompts: ${ids}.`;
    case "route_control_conflict":
      return `Route-specific status or control metadata conflicts with automatic owner correction for: ${ids}.`;
    case "stale":
      return `Current ownership or association evidence is stale or changed for: ${ids}.`;
  }
}

function buildInvalidAnswerRouteReminderContent(value: unknown): string {
  if (!isLeaderAnswerRouteDiagnostic(value)) {
    return [
      THREAD_ROUTING_REMINDER_HEADER,
      "Invalid answer route. The retained leader prose did not establish answer coverage.",
      "Takode could not safely infer one corrected owner-thread marker. Inspect the exact pending user-message IDs and route a later answer only with current server-proven ownership.",
      "Do not mark the selected thread Ready on the strength of this rejected answer.",
    ].join("\n");
  }

  const owner = value.ownerGroups.length === 1 ? value.ownerGroups[0]! : null;
  const canSuggestExactCorrection =
    owner !== null &&
    (value.reason === "missing_association" || value.reason === "disallowed_main_backfill") &&
    owner.userMessageIds.length === value.answerUserMessageIds.length &&
    owner.userMessageIds.every((id, index) => id === value.answerUserMessageIds[index]);
  const correctionLines = canSuggestExactCorrection
    ? [
        `Authoritative owner: ${formatThreadLabel(owner.threadKey)} (${owner.userMessageIds.join(",")}).`,
        `Do not regenerate the long explanation. If those IDs remain pending, send only a brief correction using [thread:${owner.threadKey}:A:${owner.userMessageIds.join(",")}].`,
      ]
    : [
        "No single corrected answer marker is safe from this evidence. Do not split or reroute the retained grouped prose automatically; inspect current ownership and pending IDs before writing any later answer.",
      ];
  return [
    THREAD_ROUTING_REMINDER_HEADER,
    `Invalid answer route from ${formatThreadLabel(value.selectedThreadKey)}. The original answer prose remains in append-only history, but it did not gain coverage.`,
    formatAnswerRouteFailure(value),
    ...correctionLines,
    `Do not mark ${formatThreadLabel(value.selectedThreadKey)} Ready on the strength of this rejected answer.`,
  ].join("\n");
}

export function buildThreadRoutingReminderContent(input: ThreadRoutingReminderInput): string {
  if (input.reason === "invalid_answer_route") {
    return buildInvalidAnswerRouteReminderContent(input.answerRouteDiagnostic);
  }
  const reason = formatThreadRoutingReminderReason(input);
  if (input.source === "visible_text") {
    if (input.reason === "missing_role" || input.reason === "invalid_role") {
      return [
        THREAD_ROUTING_REMINDER_HEADER,
        `${reason} on visible leader text. The text may remain routed for audit, but it cannot satisfy a pending user-answer requirement.`,
        "Use `[thread:main:C]` or `[thread:q-N:C]` for commentary and `[thread:main:A:u1]` or `[thread:q-N:A:u1,u2]` for an answer to explicit user-message IDs.",
        "When one leader output intentionally needs multiple thread tabs, keep the first compact marker for the first segment, then put a standalone `---` line immediately before each later role-bearing marker.",
        "Leader shell commands remain commentary and use `# thread:main` or `# thread:q-N` as the first non-empty command line.",
      ].join("\n");
    }
    return [
      THREAD_ROUTING_REMINDER_HEADER,
      `${reason} on visible leader text. The previous visible leader message was not assigned to a thread.`,
      "Resend visible leader text with `[thread:main:C]` / `[thread:q-N:C]` for commentary or `[thread:main:A:u1]` / `[thread:q-N:A:u1,u2]` for an explicit answer.",
      "When one leader output intentionally needs multiple thread tabs, keep the first role-bearing marker for the first tab, then put a standalone `---` line immediately before the next role-bearing marker.",
      "For leader shell commands, use `# thread:main` or `# thread:q-N` as the first non-empty command line.",
    ].join("\n");
  }

  if (input.source === "shell_command") {
    return [
      THREAD_ROUTING_REMINDER_HEADER,
      `${reason} on leader shell command. The previous leader shell command was not assigned to a thread.`,
      "Rerun leader shell commands with `# thread:main` or `# thread:q-N` as the first non-empty command line.",
      "For visible leader text, use `[thread:main:C]` / `[thread:q-N:C]` for commentary or `[thread:main:A:u1]` / `[thread:q-N:A:u1,u2]` for an explicit answer.",
      "If one visible leader output intentionally covers multiple thread tabs, put a standalone `---` line immediately before each later role-bearing marker.",
    ].join("\n");
  }

  return [
    THREAD_ROUTING_REMINDER_HEADER,
    `${reason}. The previous leader output was not assigned to a thread, but the output type is unavailable.`,
    "If it was visible leader text, resend it with `[thread:main:C]` / `[thread:q-N:C]` for commentary or `[thread:main:A:u1]` / `[thread:q-N:A:u1,u2]` for an explicit answer.",
    "If one visible leader output intentionally covers multiple thread tabs, use a standalone `---` line immediately before each later role-bearing marker.",
    "If it was a leader shell command, rerun it with `# thread:main` or `# thread:q-N` as the first non-empty command line.",
  ].join("\n");
}

export function isThreadRoutingReminderContent(content: string): boolean {
  return content.split(/\r?\n/, 1)[0]?.trim() === THREAD_ROUTING_REMINDER_HEADER;
}
