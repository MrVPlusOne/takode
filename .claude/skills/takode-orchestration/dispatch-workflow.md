# Dispatch Workflow

Before dispatching any quest, walk through these steps.

## 1. Check the Board

```bash
takode board show
```

See current quest state and capacity. Identify quests already in progress and available worker slots.

## 2. List Your Herd

```bash
takode list
```

See your herded sessions with status, quest claims, last activity. Identify idle workers that might be reusable.

## 3. Evaluate Idle Workers

For each idle worker, check what quest it last worked on:

```bash
takode info <N>
```

Ask: is the new quest related to this worker's recent context (same feature area, same files, direct follow-up)?

## 4. Decision Rules

| Situation | Action |
|-----------|--------|
| Idle worker with relevant context | Reuse -- send dispatch directly |
| Best worker busy but strongly relevant | Queue with `--wait-for` on the board |
| No worker has relevant context | Spawn fresh |

**Reuse** when the next task continues the worker's recent work (same feature, same files, direct follow-up). The worker already has the codebase context loaded.

**Queue** when the best worker is busy but has strong context overlap. Add the quest to the board as QUEUED with `--wait-for <blocking-quest>` and wait for the worker to free up rather than spawning a fresh session that lacks context.

**Spawn fresh** when no existing worker has relevant context. Point the new worker to relevant quests or past sessions for context:

```bash
takode spawn --message "<dispatch>"
```

Sessions use worktrees by default. Only add `--no-worktree` for read-only tasks (HQ lookups, analysis). Don't use `--fixed-name` for regular workers -- they auto-name from their quest.

Default to your own backend type unless the user specifies otherwise.

## 5. Check Herd Limit

Maintain at most **5 sessions** in your herd (reviewer sessions don't count). Before spawning, check `takode list`. If at the limit, archive the session least likely to be reused -- typically the one whose work is most complete, least related to upcoming tasks, or oldest.

## 6. Send Standardized Dispatch Message

**Use this exact template. Do not add extra context, file paths, or investigation instructions.**

```
Work on [q-XX](quest:q-XX). Read the quest and claim it: `quest show q-XX && quest claim q-XX`.
Return a plan for approval before implementing.
```

If the worker needs additional context (related sessions, rejected approaches, user decisions), add it to the quest description before dispatching. Workers have the same tools and skills you do -- they run `quest show q-XX` themselves.

## 7. Update the Board

```bash
takode board set <quest-id> --worker <N> --status PLANNING
```
