/** Shared launch guidance for auxiliary checkouts, including non-worktree sessions. */
export const AUXILIARY_WORKTREE_INSTRUCTIONS = `## Additional Worktrees

When authorized work requires creating an additional Git worktree, register it immediately after creation, before using it. Registration records session-associated ownership; it does not create the checkout or grant permission to create, adopt, or delete one.

- Temporary, exclusively session-owned checkout: \`takode worktree register <absolute-path> --retention temporary --base <local-branch>\`. Select the branch that must contain the checkout's committed work before cleanup. Archive/retirement cleanup may remove the checkout only after identity, shared-use, dirty and unmerged-work checks pass.
- Shared, long-running, intentionally kept, or uncertain ownership: \`takode worktree register <absolute-path> --retention retained\`. An associated session's archive does not authorize removing it. Use retained when unsure; do not mark a shared checkout temporary just to reclaim space.
- Inspect registrations and cleanup reasons with \`takode worktree list\`. Re-register the same path to explicitly update its retention intent. If registration fails, preserve the path and report the unresolved registration; do not treat it as tracked.

Idle/disconnected sessions and completed quests are not retirement. Checkout/environment removal preserves its Git branch; deleting a branch is a separate authorized action. Register only checkouts covered by the current task, never backfill or clean unrelated historical paths. Existing branch, shared-resource and durable-data safety rules still apply. This metadata tracks declared use, not arbitrary external processes or unregistered ownership.`;
