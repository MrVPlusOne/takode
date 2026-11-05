/** How a change treated a whole file, from git's diff header; absent for a file edited in place. */
export type FileStatus = "added" | "deleted" | "renamed";

export const FILE_STATUS_LABELS: Record<FileStatus, string> = {
  added: "New",
  deleted: "Deleted",
  renamed: "Renamed",
};

const FILE_STATUS_CLASSES: Record<FileStatus, string> = {
  added: "bg-cc-success/15 text-cc-success",
  deleted: "bg-cc-error/15 text-cc-error",
  renamed: "bg-cc-info/15 text-cc-info",
};

/**
 * A small label beside a file's name saying the change added, deleted or renamed the whole file,
 * which its line counts alone don't say (an empty new file counts +0 −0).
 */
export function FileStatusBadge({ status }: { status: FileStatus }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-px text-[11px] font-medium leading-4 ${FILE_STATUS_CLASSES[status]}`}
      data-file-status={status}
    >
      {FILE_STATUS_LABELS[status]}
    </span>
  );
}

/** "from old.ts" for a file renamed in its folder, "from old/dir/old.ts" for one that moved. */
export function renamedFromLabel(path: string, oldPath: string): string {
  const folder = (file: string) => file.slice(0, file.lastIndexOf("/") + 1);
  return `from ${folder(path) === folder(oldPath) ? oldPath.slice(folder(oldPath).length) : oldPath}`;
}
