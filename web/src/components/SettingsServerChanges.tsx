import { useState } from "react";
import type { ServerChangeList, ServerChanges } from "../api.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

/**
 * The Restart section's change lists: the commits Restart Server would load,
 * and the commits the current build brought in. Each is a collapsed row that
 * opens into the commits, newest first, with the quest that delivered each.
 */
export function SettingsServerChanges({ changes }: { changes: ServerChanges | null }) {
  if (!changes) return null;
  const { incoming, currentBuild } = changes;
  return (
    <>
      <ChangeDisclosure
        testId="server-incoming-changes"
        label={`${incoming.total} new change${incoming.total === 1 ? "" : "s"}`}
        detail="Restart Server loads these"
        list={incoming}
      />
      {currentBuild && (
        <ChangeDisclosure
          testId="server-current-build-changes"
          label={`Changes in the current build (${currentBuild.total})`}
          detail={`Since ${currentBuild.commit.slice(0, 8)}, loaded ${timeAgo(currentBuild.replacedAt)}`}
          list={currentBuild}
        />
      )}
    </>
  );
}

function ChangeDisclosure({
  testId,
  label,
  detail,
  list,
}: {
  testId: string;
  label: string;
  detail: string;
  list: ServerChangeList;
}) {
  const [open, setOpen] = useState(false);
  if (list.total === 0) return null;
  const older = list.total - list.changes.length;
  return (
    <div data-testid={testId} className="overflow-hidden rounded-lg border border-cc-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-xs hover:bg-cc-hover transition-colors cursor-pointer"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`mt-0.5 h-3 w-3 shrink-0 text-cc-muted transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        {/* The detail wraps under the label on narrow screens rather than being cut off. */}
        <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
          <span className="font-medium text-cc-fg">{label}</span>
          <span className="text-cc-muted">{detail}</span>
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-cc-border border-t border-cc-border">
          {list.changes.map((change) => (
            <li key={change.sha} className="px-3 py-2 text-xs">
              <div className="break-words text-cc-fg">{change.subject}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-cc-muted">
                {change.questId && (
                  <QuestInlineLink
                    questId={change.questId}
                    surface="chat-feed"
                    className="cc-quest-link font-mono-code hover:underline"
                  >
                    {change.questId}
                  </QuestInlineLink>
                )}
                <span title={new Date(change.committedAt).toLocaleString()}>{timeAgo(change.committedAt)}</span>
                <span className="font-mono-code">{change.sha.slice(0, 8)}</span>
              </div>
            </li>
          ))}
          {older > 0 && (
            <li className="px-3 py-2 text-xs text-cc-muted">
              and {older} older change{older === 1 ? "" : "s"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
