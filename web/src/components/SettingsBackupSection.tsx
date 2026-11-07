import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { BackupHostTarget, BackupStatus } from "../../shared/backup-status.js";
import { usePendingAction } from "../hooks/usePendingAction.js";
import { useRemoteHosts } from "../remote-hosts.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { SettingsSubsection } from "./settings-controls.js";

const POLL_WHILE_RUNNING_MS = 3000;
const INPUT_CLASS =
  "flex-1 min-w-0 px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60";
const SAVE_CLASS =
  "px-3 py-2 rounded-lg text-sm font-medium bg-cc-hover text-cc-fg hover:bg-cc-active disabled:opacity-50 disabled:cursor-not-allowed";
const SMALL_BUTTON_CLASS =
  "px-2.5 py-1.5 rounded-md text-xs font-medium border border-cc-border text-cc-fg hover:bg-cc-hover disabled:opacity-50";

/**
 * Backups of the server's data to destinations the user picked: a private Git
 * repository, and/or a Git repository on one of their machines (kept up to
 * date while that machine is online). Shows what the last backup, machine
 * copy and restore test found, with buttons to run a backup or test now.
 * Creating the repository is the user's (or an agent's) job; docs/backups.md
 * explains it.
 */
export function SettingsBackupSection({ hidden = false }: { hidden?: boolean }) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [repoDraft, setRepoDraft] = useState("");
  const [hostDraft, setHostDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const action = usePendingAction("That did not work.");
  const { hosts } = useRemoteHosts();

  const showSaved = (saved: BackupStatus) => {
    setStatus(saved);
    setRepoDraft(saved.repoUrl);
    setHostDraft(saved.host?.hostId ?? "");
    setPathDraft(saved.host?.path ?? "");
  };

  useEffect(() => {
    api
      .getBackupStatus()
      .then(showSaved)
      .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const running = status?.running ?? null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api
        .getBackupStatus()
        .then(setStatus)
        .catch((cause: unknown) => console.warn("[backup] Status refresh failed:", cause));
    }, POLL_WHILE_RUNNING_MS);
    return () => clearInterval(timer);
  }, [running]);

  const act = (request: () => Promise<BackupStatus>) => void action.run(async () => setStatus(await request()));
  const save = (targets: { repoUrl?: string; host?: BackupHostTarget | null }) =>
    void action.run(async () => showSaved(await api.setBackupTargets(targets)));

  const repoUrl = status?.repoUrl ?? "";
  const savedHost = status?.host ?? null;
  const repoChanged = repoDraft.trim() !== repoUrl;
  const hostChanged = hostDraft !== (savedHost?.hostId ?? "") || pathDraft.trim() !== (savedHost?.path ?? "");
  const enabled = !!repoUrl || !!savedHost;

  return (
    <SettingsSubsection
      title="Backup Destinations"
      description="About once an hour, Takode copies its data to the destinations you set here: quests, memory, settings (without API keys and other secrets), to-dos, the Library, your instructions and skills, and the list of sessions with their names. Once a week it restores the latest copy in a scratch folder to check it. Use a private repository you created for this, a folder on one of your machines, or both; an agent working in the Takode repository can set them up (see docs/backups.md)."
      hidden={hidden}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="backup-repo-url" className="block text-xs text-cc-muted">
            Private Git repository
          </label>
          <div className="flex gap-2">
            <input
              id="backup-repo-url"
              type="text"
              aria-label="Backup repository Git URL"
              value={repoDraft}
              onChange={(event) => setRepoDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && repoChanged) save({ repoUrl: repoDraft.trim() });
              }}
              placeholder="https://github.com/<owner>/<private-repo>.git"
              className={`${INPUT_CLASS} font-mono`}
            />
            <button
              type="button"
              aria-label="Save repository"
              onClick={() => save({ repoUrl: repoDraft.trim() })}
              disabled={!status || !repoChanged}
              aria-busy={action.pending || undefined}
              className={SAVE_CLASS}
            >
              Save
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="backup-host" className="block text-xs text-cc-muted">
            Copy on one of your machines, updated while it is online
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              id="backup-host"
              aria-label="Backup machine"
              value={hostDraft}
              onChange={(event) => setHostDraft(event.target.value)}
              className="min-w-0 px-2 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg"
            >
              <option value="">No machine</option>
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Backup folder on that machine"
              value={pathDraft}
              disabled={!hostDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              placeholder="~/Backups/takode.git"
              className={`${INPUT_CLASS} font-mono disabled:opacity-50`}
            />
            <button
              type="button"
              aria-label="Save machine"
              onClick={() => save({ host: hostDraft ? { hostId: hostDraft, path: pathDraft.trim() } : null })}
              disabled={!status || !hostChanged || (!!hostDraft && !pathDraft.trim())}
              aria-busy={action.pending || undefined}
              className={SAVE_CLASS}
            >
              Save
            </button>
          </div>
        </div>
        {status && <BackupState status={status} />}
        {enabled && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!running}
              aria-busy={action.pending || undefined}
              onClick={() => act(api.startBackup)}
              className={SMALL_BUTTON_CLASS}
            >
              Back up now
            </button>
            <button
              type="button"
              disabled={!!running || !status?.lastSuccessAt}
              aria-busy={action.pending || undefined}
              onClick={() => act(api.startBackupRestoreTest)}
              className={SMALL_BUTTON_CLASS}
            >
              Test restore
            </button>
          </div>
        )}
        {(action.error || loadError) && <p className="text-xs text-cc-error">{action.error || loadError}</p>}
      </div>
    </SettingsSubsection>
  );
}

const RUNNING_LABELS: Record<NonNullable<BackupStatus["running"]>, string> = {
  backup: "Backing up…",
  test: "Testing a restore…",
  host: "Updating the copy on the backup machine…",
};

function BackupState({ status }: { status: BackupStatus }) {
  if (!status.repoUrl && !status.host) return <p className="text-xs text-cc-muted">Backups are off.</p>;
  const run = status.lastRun;
  const test = status.lastTest;
  const sync = status.hostSync;
  return (
    <div className="space-y-1 text-xs">
      {status.running && <p className="text-cc-fg">{RUNNING_LABELS[status.running]}</p>}
      <p className={run && !run.ok ? "text-cc-error" : "text-cc-muted"}>
        {!run
          ? "No backup yet."
          : run.ok
            ? `Last backup ${timeAgo(run.startedAt)}: ${run.changed ? `${run.quests} quests saved` : "nothing had changed"}.`
            : `Last backup ${timeAgo(run.startedAt)} failed: ${run.errors.join("; ")}`}
      </p>
      {status.consecutiveFailures > 1 && (
        <p className="text-cc-error">
          {status.consecutiveFailures} failures in a row;{" "}
          {status.lastSuccessAt ? `last success ${timeAgo(status.lastSuccessAt)}` : "no backup has succeeded yet"}.
        </p>
      )}
      {status.host && (
        <p className={sync?.error ? "text-cc-error" : "text-cc-muted"}>
          {`Copy on ${status.hostName ?? "the machine"}: `}
          {sync?.lastSuccessAt ? `updated ${timeAgo(sync.lastSuccessAt)}` : "not updated yet"}
          {sync?.error ? `; last try failed: ${sync.error}` : sync?.waiting ? `; waiting (${sync.waiting})` : ""}.
        </p>
      )}
      {test && (
        <p className={test.ok ? "text-cc-muted" : "text-cc-error"}>
          {test.ok
            ? `Restore test ${timeAgo(test.at)}: passed.`
            : `Restore test ${timeAgo(test.at)} failed: ${test.problems.join("; ")}`}
        </p>
      )}
    </div>
  );
}
