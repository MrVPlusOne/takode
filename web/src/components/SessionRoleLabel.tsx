import {
  QUEST_PARTICIPANT_ROLE_CLASS,
  QUEST_PARTICIPANT_ROLE_INITIAL_CLASS,
  QUEST_REVIEWER_ROLE_CLASS,
} from "./quest-participant-chip-style.js";

export type SessionParticipantRole = "Leader" | "Worker" | "Reviewer";

export function SessionRoleIcon({ role, className = "h-3 w-3" }: { role: SessionParticipantRole; className?: string }) {
  if (role === "Leader") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className={`${className} shrink-0 opacity-75`}
        aria-hidden="true"
        data-testid="session-role-icon-leader"
      >
        <path d="M8 2a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM3.5 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM12.5 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM8 4.5v2M5 7.5L7 6M11 7.5L9 6M3.5 8v2.5a1 1 0 001 1h7a1 1 0 001-1V8" />
      </svg>
    );
  }

  if (role === "Worker") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        className={`${className} shrink-0 opacity-75`}
        aria-hidden="true"
        data-testid="session-role-icon-worker"
      >
        <path d="M3 4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v5A1.5 1.5 0 0111.5 11h-7A1.5 1.5 0 013 9.5v-5Z" />
        <path d="M6.5 13h3M8 11v2M6.5 7h3M8 5.5v3" strokeLinecap="round" />
      </svg>
    );
  }

  return null;
}

export function SessionRoleLabel({ role, showIcon = true }: { role: SessionParticipantRole; showIcon?: boolean }) {
  const usesMobileFullLabel = role === "Leader" || role === "Worker";
  return (
    <>
      {showIcon && <SessionRoleIcon role={role} />}
      <span className={usesMobileFullLabel ? QUEST_PARTICIPANT_ROLE_CLASS : QUEST_REVIEWER_ROLE_CLASS}>{role}</span>
      {usesMobileFullLabel && (
        <span className={QUEST_PARTICIPANT_ROLE_INITIAL_CLASS} aria-hidden="true">
          {role.charAt(0)}
        </span>
      )}
    </>
  );
}
