# Landing -- Assignee Brief

Nobody works in this phase. The quest waits here, not the worker: Work submitted the change to the landing queue and handed the quest to Memory, final Memory completed, and the change has not landed yet.

- The landing queue starts its own landing run, stacks the change with whatever else waits, runs the gate and pushes. When the change lands, Takode records the landed commits as the quest's code evidence and completes the quest with the debrief, review checks and memory commits final Memory supplied. Nobody attaches the commits by hand.
- The worker that submitted the change is free for other work as soon as final Memory completes.
- If the change bounces (or is withdrawn), the quest stays here and the leader decides who fixes it and when. Whoever is asked to fix it gets a normal Work handoff for the quest's next Work occurrence; the Work assignee brief covers restoring the change with `takode land resume <entry-id>`.
