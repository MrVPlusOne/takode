/** Client deadline for one server-run `stream` command. */
export const STREAM_SERVER_COMMAND_TIMEOUT_MS = 30_000;

/** Body of `POST /api/streams/command`: one `stream` invocation run by the server. */
export interface StreamServerCommandRequest {
  args: string[];
  /** Values the command would otherwise read from the caller's environment and checkout. */
  context: {
    sessionId?: string;
    serverId?: string;
    /** Default scope outside a session, from the caller's Git project. */
    projectScope?: string;
  };
  /** Contents of files named on the command line, keyed by the path exactly as given. */
  files?: Record<string, string>;
}
