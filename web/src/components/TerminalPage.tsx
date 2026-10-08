import { useState } from "react";
import { useStore } from "../store.js";
import { useRemoteHosts } from "../remote-hosts.js";
import { FolderPicker } from "./FolderPicker.js";
import { TerminalView } from "./TerminalView.js";

export function TerminalPage() {
  const terminalCwd = useStore((s) => s.terminalCwd);
  const terminalSessionId = useStore((s) => s.terminalSessionId);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const sessions = useStore((s) => s.sessions);
  const sdkSessions = useStore((s) => s.sdkSessions);
  const [showTerminalPicker, setShowTerminalPicker] = useState(false);
  const [hostPathDraft, setHostPathDraft] = useState<string | null>(null);
  const effectiveSessionId = terminalSessionId ?? currentSessionId;
  const effectiveSdkSession = sdkSessions.find((session) => session.sessionId === effectiveSessionId);
  const effectiveSessionCwd =
    (effectiveSessionId ? sessions.get(effectiveSessionId)?.cwd : null) ?? effectiveSdkSession?.cwd ?? null;
  const effectiveCwd = terminalCwd ?? effectiveSessionCwd;
  // The server opens a session's terminal on its remote host; this machine's folder picker cannot browse there.
  const hostId = effectiveSdkSession?.hostId;
  const host = useRemoteHosts().hosts.find((candidate) => candidate.id === hostId);
  const hostLabel = hostId ? (host?.name ?? "a remote host") : null;

  const openFolder = (path: string) => {
    useStore.getState().openTerminal(path, effectiveSessionId);
    window.location.hash = "#/terminal";
  };

  return (
    <div className="h-full bg-cc-bg overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10 h-full flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-6 shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-cc-fg">Terminal</h1>
            <p className="mt-1 text-sm text-cc-muted">
              Run shell commands in a project folder without leaving the Companion.
            </p>
            {hostLabel && (
              <p data-testid="terminal-host" className="mt-1 text-sm text-cc-muted">
                Runs on <span className="font-medium text-cc-fg">{hostLabel}</span>
                {host && !host.online && ", which is offline: an open terminal continues when it reconnects"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => (hostId ? setHostPathDraft(effectiveCwd ?? "") : setShowTerminalPicker(true))}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            {effectiveCwd ? "Change Folder" : "Choose Folder"}
          </button>
        </div>

        {hostPathDraft !== null && (
          <form
            className="flex items-center gap-2 mb-4 shrink-0"
            onSubmit={(event) => {
              event.preventDefault();
              if (hostPathDraft.trim()) openFolder(hostPathDraft.trim());
              setHostPathDraft(null);
            }}
          >
            <input
              autoFocus
              value={hostPathDraft}
              onChange={(event) => setHostPathDraft(event.target.value)}
              placeholder={`Absolute path on ${hostLabel}`}
              aria-label={`Folder on ${hostLabel}`}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-cc-input-bg border border-cc-border text-sm font-mono-code text-cc-fg"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors cursor-pointer"
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => setHostPathDraft(null)}
              className="px-3 py-1.5 rounded-lg text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </form>
        )}

        <div className="flex-1 min-h-[420px]">
          {effectiveCwd ? (
            <TerminalView cwd={effectiveCwd} sessionId={effectiveSessionId ?? undefined} embedded />
          ) : (
            <div className="h-full bg-cc-card border border-cc-border rounded-xl p-6 sm:p-8 flex items-center justify-center text-center">
              <div className="max-w-md">
                <h2 className="text-lg font-semibold text-cc-fg mb-2">No terminal started yet</h2>
                <p className="text-sm text-cc-muted">
                  Choose a folder to start a terminal session. You can switch folders anytime.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showTerminalPicker && (
        <FolderPicker
          initialPath={effectiveCwd || ""}
          onSelect={(path) => {
            openFolder(path);
            setShowTerminalPicker(false);
          }}
          onClose={() => setShowTerminalPicker(false)}
        />
      )}
    </div>
  );
}
