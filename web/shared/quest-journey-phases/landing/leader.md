# Landing -- Leader Brief

Takode adds this phase after Memory when Work hands a submitted landing-queue change to Memory (`work-to-memory --landing-entry`), and moves the quest here when final Memory completes before the change has landed. The quest waits; the worker is free. Treat a worker whose only quest is in Landing like a worker whose quest finished: reuse it when its context helps the next quest, or replace it.

While the change waits or lands:
- Do nothing for the quest. The landing queue starts its own runs. When the change lands, Takode records the landed commits as the quest's code evidence (the delivery Work would otherwise have recorded) and completes the quest with final Memory's debrief, review checks and memory commits; you get a Landing Queue message with the delivery ID for `quest commit-links`. Report that the change landed and the quest is complete; it was already reported as submitted, not delivered.
- The change is not delivered until it lands. Until then, describe it as submitted, and keep dependents that need the code waiting: a quest in Memory or Landing whose change has not landed still blocks `--wait-for` dependents.
- `takode land status` shows the queue. If the queue keeps failing, Takode messages you; `takode land run --branch <branch>`, run in a checkout of the repository, starts a runner on your machine by hand.

When the change bounces or is withdrawn:
- Takode keeps the quest in Landing, adds a Work and a Memory occurrence after it, and messages you with the reason. Decide who fixes it and when; this is a judgment call, not a fixed rule. The original worker has the most context and is usually best when it is free or about to be. A fix that is not urgent can wait behind other work, for example as a queued dependency of the worker's current quest. Another worker works too: it gets the Work note and the bounce output, and `takode land resume <entry-id>` restores the change in its worktree.
- If someone other than the current owner fixes it, move ownership with `quest reassign` and set the row's worker. Then `takode board advance q-N` starts the next Work occurrence; send the fixer a normal Work handoff naming the entry ID and the bounce reason. The fix goes through `takode land test`, `takode land submit`, `work-to-memory --landing-entry` and a short Memory that confirms or corrects the earlier debrief and memory notes, then Landing again.
- To drop the change instead, cancel or re-plan the quest as usual.
