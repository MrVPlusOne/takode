/** Where backups go: a Git repository URL, and/or a repository on a machine with a `takode node`. */
export interface BackupTargets {
  /** Git URL of the backup repository; empty when none. */
  repoUrl: string;
  /** A repository on a registered machine (such as the user's laptop), kept up to date while it is online. */
  host: BackupHostTarget | null;
}

export interface BackupHostTarget {
  hostId: string;
  /** Folder of the (bare) repository on that machine; a leading `~` is its home. */
  path: string;
}

/** Backups as Settings and `takode backup status` show them (see server/backup/backup-service.ts). */
export interface BackupStatus extends BackupTargets {
  /** The machine's name, for `host`. */
  hostName: string | null;
  /** What runs right now. */
  running: "backup" | "test" | "host" | null;
  lastRun?: {
    startedAt: number;
    finishedAt: number;
    ok: boolean;
    /** Whether the run committed a change; an unchanged run only checks the push. */
    changed: boolean;
    commit: string | null;
    quests: number;
    errors: string[];
  };
  /** When the last successful run started. */
  lastSuccessAt?: number;
  /** Failed runs since the last success. */
  consecutiveFailures: number;
  /** Whether the user was alerted about the current run of failures. */
  failureAlerted: boolean;
  lastTest?: {
    at: number;
    ok: boolean;
    /** When the snapshot the test restored was written. */
    snapshotAt: string | null;
    problems: string[];
  };
  /** The copy on the `host` machine. */
  hostSync?: {
    /** Why it waits, such as "is offline"; null when it is not waiting. */
    waiting: string | null;
    /** The backup run whose result the copy holds. */
    syncedRunAt?: number;
    lastSuccessAt?: number;
    lastAttemptAt?: number;
    error: string | null;
    consecutiveFailures: number;
    failureAlerted: boolean;
  };
}
