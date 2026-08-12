export const QUEST_PARTICIPANT_CHIP_CLASS =
  "inline-flex h-5 max-w-[9.5rem] min-w-0 items-center gap-1 rounded-full border border-cc-border/60 bg-cc-hover/25 px-1.5 text-[10px] leading-none cc-participant-muted-readable transition-colors hover:border-cc-primary/45 hover:bg-cc-hover/55 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50 active:bg-cc-hover/70 sm:max-w-[12rem]";

// Full participant roles remain visible at standard mobile widths. The initial
// is reserved for sub-320px layouts where the complete label cannot fit.
export const QUEST_PARTICIPANT_ROLE_CLASS = "shrink-0 cc-participant-muted-readable max-[319px]:hidden";
export const QUEST_PARTICIPANT_ROLE_INITIAL_CLASS = "hidden shrink-0 cc-participant-muted-readable max-[319px]:inline";
export const QUEST_REVIEWER_ROLE_CLASS = "hidden shrink-0 cc-participant-muted-readable sm:inline";
export const QUEST_PARTICIPANT_SESSION_CLASS = "shrink-0 font-mono-code text-cc-attention";
export const QUEST_PARTICIPANT_NAME_CLASS = "hidden min-w-0 truncate text-cc-fg/75 md:inline";
