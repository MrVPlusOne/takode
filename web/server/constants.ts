export const DEFAULT_PORT_DEV = 3457;
export const DEFAULT_PORT_PROD = 3456;
export const RESTART_EXIT_CODE = 42;
/** Exit code of a server that found another process holding its state; supervisors must not restart it. */
export const COORDINATOR_SUPERSEDED_EXIT_CODE = 43;
export const GIT_CMD_TIMEOUT = Number(process.env.COMPANION_GIT_TIMEOUT) || 60_000;
export const SERVER_GIT_CMD = "git --no-optional-locks -c core.fsmonitor=false";
