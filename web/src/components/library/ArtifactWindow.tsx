import { ArtifactViewer } from "./ArtifactViewer.js";

/**
 * A window showing only one artifact (`#/artifact/<id>`), opened with "Open in new window" or
 * Cmd/Ctrl-click so it can stay open beside Takode. It keeps up with new versions by itself.
 */
export function ArtifactWindow({ id, version }: { id: string; version?: number }) {
  return (
    <div
      className="flex h-[100dvh] min-h-0 flex-col bg-cc-bg font-sans-ui text-cc-fg antialiased"
      data-testid="artifact-window"
    >
      <ArtifactViewer id={id} version={version ?? null} standalone />
    </div>
  );
}
