/**
 * Creates sessions the way the session API does (default model, backend program, tree group and
 * memory space), for server features that start their own agent, such as the Library's page writer.
 * Registered by the sessions routes, which own session preparation.
 */
export type LibrarySessionCreator = (
  body: Record<string, unknown>,
  internal?: { scribeFor?: string },
) => Promise<{ sessionId: string }>;

let creator: LibrarySessionCreator | null = null;

export function setLibrarySessionCreator(next: LibrarySessionCreator): void {
  creator = next;
}

export function createLibrarySession(
  body: Record<string, unknown>,
  internal?: { scribeFor?: string },
): Promise<{ sessionId: string }> {
  if (!creator) throw new Error("Sessions cannot be created yet.");
  return creator(body, internal);
}

/** Archives a session the way the session API does; registered by the archive routes. */
export type LibrarySessionArchiver = (sessionId: string) => Promise<unknown>;

let archiver: LibrarySessionArchiver | null = null;

export function setLibrarySessionArchiver(next: LibrarySessionArchiver): void {
  archiver = next;
}

export async function archiveLibrarySession(sessionId: string): Promise<void> {
  if (!archiver) throw new Error("Sessions cannot be archived yet.");
  await archiver(sessionId);
}
