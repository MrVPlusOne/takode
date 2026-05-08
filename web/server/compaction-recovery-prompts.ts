import {
  LEADER_COMPACTION_RECOVERY_PREFIX,
  STANDARD_COMPACTION_RECOVERY_PREFIX,
  isCompactionRecoveryPrompt as isCurrentCompactionRecoveryPrompt,
} from "../shared/injected-event-message.js";

export const LEGACY_LEADER_COMPACTION_RECOVERY_PROMPT = `${LEADER_COMPACTION_RECOVERY_PREFIX}

1. Load skills: /takode-orchestration, /leader-dispatch, and /quest
2. Run the preferred leader recovery summary: \`takode leader-context-resume <your-session-number>\`
3. Key rules:
   - Treat the recovery summary as the first pass, then use manual follow-ups when the summary is stale, insufficient, or leaves phase history or user intent unclear
   - Hard stop: if the summary or notifications show unresolved user decisions or \`needs-input\` prompts, do not dispatch, advance quests, or answer on the user's behalf until the decision is resolved
   - Use \`takode scan <your-session-number>\` to inspect your own session history and recover enough earlier context before acting
   - If durable memory may affect the current decision, run \`memory catalog show\` for orientation; inspect plausible catalog-listed files directly, especially \`current/\`, \`decisions/\`, and \`procedures/\`; use targeted \`rg\` under \`$(memory repo path)\` only when catalog or known context makes a match plausible; skip blind repo-wide memory search when the catalog shows no plausible relevant topic, type, or source
   - Use \`takode board show\` to verify active Journey state and \`takode list\` to reconcile herd/session state when board or worker context matters
   - Use \`takode spawn\` to create workers (never Agent tool)
   - Invoke /leader-dispatch before every dispatch
   - Follow quest-journey.md for lifecycle transitions
   - Update the board (\`takode board set/advance\`) at every phase transition
   - Make worker instructions phase-explicit: plan only, perform the approved next phase and stop, review/rework and report back, port only when explicitly told
   - Never implement non-trivial changes yourself -- delegate to workers`;

export const LEGACY_STANDARD_COMPACTION_RECOVERY_PROMPT = `${STANDARD_COMPACTION_RECOVERY_PREFIX}

1. Inspect your own session history with Takode tools. Start with \`takode scan <your-session-number>\`
2. If you still need detail, inspect your own session further with Takode tools such as \`takode peek <your-session-number>\` or \`takode read <your-session-number>\`
3. Re-read the quest or latest assignment only after you have recovered enough earlier context from your own session
4. If durable memory may affect the task, run \`memory catalog show\` for orientation, inspect plausible catalog-listed files directly, and use targeted \`rg\` under \`$(memory repo path)\` only when catalog or known context makes a match plausible. If the catalog shows no plausible relevant topic, type, or source, skip blind repo-wide memory search
5. Keep your current role. If you are a worker or reviewer, continue the assigned task and do not switch into leader/orchestration behavior`;

export function getCompactionRecoveryPrompt(role: "leader" | "standard", sessionRef: string): string {
  return role === "leader"
    ? `${LEADER_COMPACTION_RECOVERY_PREFIX}

1. Load skills: /takode-orchestration, /leader-dispatch, and /quest
2. Run the preferred leader recovery summary: \`takode leader-context-resume ${sessionRef}\`
3. Key rules:
   - Treat the recovery summary as the first pass, then use manual follow-ups when the summary is stale, insufficient, or leaves phase history or user intent unclear
   - Hard stop: if the summary or notifications show unresolved user decisions or \`needs-input\` prompts, do not dispatch, advance quests, or answer on the user's behalf until the decision is resolved
   - Use \`takode scan ${sessionRef}\` to inspect your own session history and recover enough earlier context before acting
   - If durable memory may affect the current decision, run \`memory catalog show\` for orientation; inspect plausible catalog-listed files directly, especially \`current/\`, \`decisions/\`, and \`procedures/\`; use targeted \`rg\` under \`$(memory repo path)\` only when catalog or known context makes a match plausible; skip blind repo-wide memory search when the catalog shows no plausible relevant topic, type, or source
   - Use \`takode board show\` to verify active Journey state and \`takode list\` to reconcile herd/session state when board or worker context matters
   - Use \`takode spawn\` to create workers (never Agent tool)
   - Invoke /leader-dispatch before every dispatch
   - Follow quest-journey.md for lifecycle transitions
   - Update the board (\`takode board set/advance\`) at every phase transition
   - Make worker instructions phase-explicit: plan only, perform the approved next phase and stop, review/rework and report back, port only when explicitly told
   - Never implement non-trivial changes yourself -- delegate to workers`
    : `${STANDARD_COMPACTION_RECOVERY_PREFIX}

1. Inspect your own session history with Takode tools. Start with \`takode scan ${sessionRef}\`
2. If you still need detail, inspect your own session further with Takode tools such as \`takode peek ${sessionRef}\` or \`takode read ${sessionRef}\`
3. Re-read the quest or latest assignment only after you have recovered enough earlier context from your own session
4. If durable memory may affect the task, run \`memory catalog show\` for orientation, inspect plausible catalog-listed files directly, and use targeted \`rg\` under \`$(memory repo path)\` only when catalog or known context makes a match plausible. If the catalog shows no plausible relevant topic, type, or source, skip blind repo-wide memory search
5. Keep your current role. If you are a worker or reviewer, continue the assigned task and do not switch into leader/orchestration behavior`;
}

export function isCompactionRecoveryPrompt(content: string): boolean {
  return (
    content === LEGACY_LEADER_COMPACTION_RECOVERY_PROMPT ||
    content === LEGACY_STANDARD_COMPACTION_RECOVERY_PROMPT ||
    isCurrentCompactionRecoveryPrompt(content)
  );
}
