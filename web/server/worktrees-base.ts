import { homedir } from "node:os";
import { join } from "node:path";

/** A machine's default folder for session worktrees, given its home directory. */
export function defaultWorktreesBase(home: string): string {
  return join(home, ".companion", "worktrees");
}

/** This machine's default folder for session worktrees. */
export const WORKTREES_BASE = defaultWorktreesBase(homedir());
