import { useState } from "react";
import { ContextMenu } from "../ContextMenu.js";
import { SessionArchiveConfirmation } from "../SessionArchiveConfirmation.js";
import { PlaygroundSectionGroup, Section } from "./shared.js";

export function PlaygroundSessionHeaderMenu() {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [archive, setArchive] = useState(false);
  const [result, setResult] = useState("");
  const finish = (label: string) => {
    setResult(`${label}: preview only`);
    setArchive(false);
    setOpen(false);
    setPosition(null);
  };
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Session Header Menu"
        description="Right-click the session title. These representative mock actions never operate on a real session."
      >
        <div className="rounded-lg border border-cc-border bg-cc-card p-3" data-testid="playground-session-header-menu">
          <button
            className="min-w-0 truncate text-[11px] font-medium text-cc-fg hover:opacity-80"
            onClick={() => finish("Session info")}
            onContextMenu={(event) => {
              event.preventDefault();
              setArchive(false);
              setOpen(true);
              setPosition({ x: event.clientX, y: event.clientY });
            }}
          >
            #12 Review workspace changes
          </button>
          <p className="mt-3 text-xs text-cc-muted" aria-live="polite">
            {result || "The sidebar can stay closed."}
          </p>
        </div>
        {position && (open || archive) && (
          <ContextMenu
            {...position}
            onClose={() => {
              if (archive) finish("Cancelled");
              else setOpen(false);
            }}
            widthClassName="w-56 max-w-[calc(100vw-1rem)]"
            items={
              archive
                ? []
                : [
                    { label: "Configure Session", onClick: () => finish("Configure Session") },
                    { label: "Relaunch", onClick: () => finish("Relaunch") },
                    { label: "Archive", onClick: () => setArchive(true) },
                  ]
            }
            footer={
              archive && (
                <SessionArchiveConfirmation
                  archiveConfirmation={{ sessionId: "preview-session", kind: "worktree" }}
                  onCancelArchive={() => finish("Cancelled")}
                  onConfirmArchive={() => finish("Archive")}
                />
              )
            }
          />
        )}
      </Section>
    </PlaygroundSectionGroup>
  );
}
