/** Maximum wall time allowed for the server-owned Quest CLI process. */
export const QUEST_COMMAND_RUNNER_TIMEOUT_MS = 60_000;

/** Client deadline includes a margin to receive the server's timeout response. */
export const QUEST_COMMAND_CLIENT_TIMEOUT_MS = QUEST_COMMAND_RUNNER_TIMEOUT_MS + 5_000;
