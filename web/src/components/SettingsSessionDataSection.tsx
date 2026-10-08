import { useRef, useState } from "react";
import { api, type ImportStats } from "../api.js";
import { SettingsSubsection } from "./settings-controls.js";

/** Export every session to a portable archive, or import one from another machine. */
export function SettingsSessionDataSection({ hidden = false }: { hidden?: boolean }) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState("");
  const [importPct, setImportPct] = useState<number | undefined>(undefined);
  const [importResult, setImportResult] = useState<ImportStats | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const link = document.createElement("a");
      link.href = api.exportSessionsUrl();
      link.download = "";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setTimeout(() => setExporting(false), 2000);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    setImportStep("");
    setImportPct(undefined);
    try {
      const stats = await api.importSessions(file, (_step, message, pct) => {
        setImportStep(message);
        setImportPct(pct);
      });
      setImportResult(stats);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  const buttonClass = (busy: boolean) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      busy ? "bg-cc-hover text-cc-muted cursor-not-allowed" : "bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer"
    }`;

  return (
    <SettingsSubsection
      title="Export & Import"
      description="Export all sessions to a portable archive, or import sessions from another machine. Paths are automatically rewritten to match this machine."
      hidden={hidden}
    >
      <input ref={importInputRef} type="file" accept=".tar.zst,.zst" onChange={handleImportFile} className="hidden" />

      <div className="flex items-center gap-2">
        <button type="button" onClick={handleExport} disabled={exporting} className={buttonClass(exporting)}>
          {exporting ? "Exporting..." : "Export All Sessions"}
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          disabled={importing}
          className={buttonClass(importing)}
        >
          {importing ? "Importing..." : "Import Sessions"}
        </button>
      </div>

      {importing && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-cc-muted">
            <span>{importStep || "Starting import..."}</span>
            <span>{importPct != null ? `${importPct}%` : ""}</span>
          </div>
          <div className="h-1.5 rounded-full bg-cc-hover overflow-hidden">
            {importPct != null ? (
              <div
                className="h-full bg-cc-accent rounded-full transition-[width] duration-200"
                style={{ width: `${importPct}%` }}
              />
            ) : (
              <div className="h-full bg-cc-accent rounded-full animate-pulse w-full" />
            )}
          </div>
        </div>
      )}

      {importError && (
        <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
          Import failed: {importError}
        </div>
      )}

      {importResult && (
        <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success space-y-0.5">
          <div className="font-medium">Import complete</div>
          {importResult.sessionsNew > 0 && <div>{importResult.sessionsNew} new sessions imported</div>}
          {importResult.sessionsUpdated > 0 && <div>{importResult.sessionsUpdated} updated (archive was newer)</div>}
          {importResult.sessionsSkipped > 0 && <div>{importResult.sessionsSkipped} skipped (local was newer)</div>}
          {importResult.claudeSessionsRestored > 0 && (
            <div>
              {importResult.claudeSessionsRestored} Claude Code sessions restored (conversation context preserved)
            </div>
          )}
          {importResult.worktreeSessionsNeedingRecreation > 0 && (
            <div>{importResult.worktreeSessionsNeedingRecreation} worktree sessions will recreate on open</div>
          )}
          {importResult.pathsRewritten && <div>Paths rewritten for this machine</div>}
        </div>
      )}
    </SettingsSubsection>
  );
}
