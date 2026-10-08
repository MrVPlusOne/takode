# Server shutdown

Takode stops admitting launches, recovery, model input and timer firings when
shutdown starts. Work already accepted may finish handing off its pending state;
already-running backend output can still be recorded. Repeated signals or restart
requests share one shutdown operation.

A stop (`SIGTERM`, `SIGINT`) first stops every session whose process runs
under a connected `takode node`, on this machine or a remote host, and then
this machine's node, while the nodes are still connected to receive it. A restart
(the Restart Server button) skips this so the next server takes those sessions
over. `takode restart` of an installed service stops the server with `SIGTERM`
and starts it again, so it stops them too.

Listener and non-data cleanup stages have a five-second budget each. Bun 1.3.10
can leave `server.stop(true)` pending after a server-initiated WebSocket close,
even when the client has closed. A listener timeout is logged and shutdown
continues to persistence. An uncertain listener never authorizes deleting the
frontend snapshot; the supervisor removes its snapshot only after actual exit.

Buffered worker events are transferred into the existing durable pending-input
queues without starting model work. Accepted work, session state, launcher identity,
timers and container state must
finish saving before exit. A stalled save reports its stage and continues waiting.
A failed save leaves the server inactive, preserves the in-memory state and blocks
automatic replacement. This is an intentional exception to bounded shutdown.
The supervisor does not escalate the backend to SIGKILL after a timeout. A separate
operator decision is required to abandon unsaved state.

This shutdown policy is process-local. It does not add a shared-state ownership
lock, change Codex writer-conflict or conversation-ID behavior, or recover servers
that were already stranded. A free port alone is not proof that an old process
has exited. Deployment does not activate these changes in already-running servers.
