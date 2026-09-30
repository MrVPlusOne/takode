export interface ArchiveConfirmationState {
  sessionId: string;
  kind: "worktree" | "container" | "leader";
  activeWorkerCount?: number;
  leaderArchiveDestructiveTarget?: "worktree" | "container";
}

/** Shared destructive-archive warning and leader/herd choices. */
export function SessionArchiveConfirmation({
  archiveConfirmation,
  onConfirmArchive,
  onConfirmArchiveHerdMembers,
  onCancelArchive,
}: {
  archiveConfirmation: ArchiveConfirmationState;
  onConfirmArchive: () => void;
  onConfirmArchiveHerdMembers?: () => void;
  onCancelArchive: () => void;
}) {
  return (
    <div className="mx-1 mt-1 mb-0.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5">
          <path d="M8.982 1.566a1.13 1.13 0 00-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 01-1.1 0L7.1 5.995A.905.905 0 018 5zm.002 6a1 1 0 110 2 1 1 0 010-2z" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-cc-fg leading-snug">
            {archiveConfirmation.kind === "worktree" ? (
              <>
                Archiving will <strong>delete the worktree</strong> and any uncommitted changes.
              </>
            ) : archiveConfirmation.kind === "leader" ? (
              <>
                Choose whether to archive only this leader or archive it with{" "}
                <strong>
                  {archiveConfirmation.activeWorkerCount ?? 0} active herd member session
                  {archiveConfirmation.activeWorkerCount === 1 ? "" : "s"}
                </strong>
                .
                {archiveConfirmation.leaderArchiveDestructiveTarget === "worktree" && (
                  <>
                    {" "}
                    Either choice will <strong>delete this leader&apos;s worktree</strong> and any uncommitted changes.
                  </>
                )}
                {archiveConfirmation.leaderArchiveDestructiveTarget === "container" && (
                  <>
                    {" "}
                    Either choice will <strong>remove this leader&apos;s container</strong> and any uncommitted changes.
                  </>
                )}
              </>
            ) : (
              <>
                Archiving will <strong>remove the container</strong> and any uncommitted changes.
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2 mt-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancelArchive();
              }}
              className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-cc-hover text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            {archiveConfirmation.kind === "leader" ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirmArchive();
                  }}
                  className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer"
                >
                  Archive Leader Only
                </button>
                {onConfirmArchiveHerdMembers && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfirmArchiveHerdMembers();
                    }}
                    className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer"
                  >
                    Archive Leader + Herd
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmArchive();
                }}
                className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer"
              >
                Archive
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
