import { useState } from "react";
import { useStore } from "../store.js";
import { useRemoteHosts } from "../remote-hosts.js";
import { getRecentDirs, hostRecentDirsKey } from "../utils/recent-dirs.js";
import { FolderPicker } from "./FolderPicker.js";
import { TerminalView } from "./TerminalView.js";

/** Recent-folder list for a machine: a remote host keeps its own, this machine uses the default one. */
function recentDirsKeyFor(hostId: string | null): string | undefined {
  return hostId ? hostRecentDirsKey(hostId) : undefined;
}

/**
 * Full-page terminal. The top bar already names the page, so the only chrome is
 * one compact row naming the machine and folder, each of which can be changed.
 */
export function TerminalPage() {
  const terminalCwd = useStore((s) => s.terminalCwd);
  const terminalSessionId = useStore((s) => s.terminalSessionId);
  const terminalHostId = useStore((s) => s.terminalHostId);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const sessions = useStore((s) => s.sessions);
  const sdkSessions = useStore((s) => s.sdkSessions);
  const { hosts, local } = useRemoteHosts();
  /** Folder picker for a machine (null for this server's); a machine switch waits for its folder. */
  const [picker, setPicker] = useState<{ hostId: string | null; initialPath: string } | null>(null);
  const effectiveSessionId = terminalSessionId ?? currentSessionId;
  const effectiveSdkSession = sdkSessions.find((session) => session.sessionId === effectiveSessionId);
  const effectiveSessionCwd =
    (effectiveSessionId ? sessions.get(effectiveSessionId)?.cwd : null) ?? effectiveSdkSession?.cwd ?? null;
  // An explicitly opened folder carries its machine; otherwise follow the session's.
  const effectiveCwd = terminalCwd ?? effectiveSessionCwd;
  const hostId = terminalCwd ? terminalHostId : (effectiveSdkSession?.hostId ?? null);
  const host = hosts.find((candidate) => candidate.id === hostId);
  const shownHostId = picker ? picker.hostId : hostId;
  // With no remote host there is only one machine, so there is nothing to show or pick.
  const showMachine = hosts.length > 0 || !!hostId;

  const openFolder = (path: string, folderHostId: string | null) => {
    useStore.getState().openTerminal(path, effectiveSessionId, folderHostId);
    window.location.hash = "#/terminal";
  };

  const switchMachine = (nextHostId: string | null) => {
    if (nextHostId === hostId) return;
    // Paths name a folder on one machine only: start from that machine's latest folder.
    setPicker({ hostId: nextHostId, initialPath: getRecentDirs(recentDirsKeyFor(nextHostId))[0] || "" });
  };

  return (
    <div className="h-full bg-cc-bg flex flex-col p-1.5 sm:p-4">
      <div className="mx-auto w-full max-w-5xl flex-1 min-h-0 flex flex-col rounded-[14px] shadow-2xl overflow-hidden border border-cc-border">
        <div
          data-testid="terminal-location-bar"
          className="flex items-center gap-1 px-1.5 py-1 border-b border-cc-border bg-cc-sidebar shrink-0 min-w-0"
        >
          {showMachine && (
            <label className="flex items-center gap-1 shrink-0 max-w-[45%] rounded-md px-1.5 py-1 text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer">
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5 shrink-0 opacity-70"
                aria-hidden="true"
              >
                <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm9.5 2a.75.75 0 100-1.5.75.75 0 000 1.5zM2 10a1 1 0 011-1h10a1 1 0 011 1v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3zm9.5 2a.75.75 0 100-1.5.75.75 0 000 1.5z" />
              </svg>
              <select
                aria-label="Machine"
                value={shownHostId ?? ""}
                onChange={(event) => switchMachine(event.target.value || null)}
                className="min-w-0 truncate bg-transparent text-xs font-medium text-cc-fg outline-none cursor-pointer"
              >
                <option value="">{local?.name ?? "This machine"}</option>
                {hostId && !host && <option value={hostId}>a removed host</option>}
                {hosts.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.online ? candidate.name : `${candidate.name} (offline)`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showMachine && <span className="text-cc-muted/50 text-xs shrink-0">/</span>}
          <button
            type="button"
            aria-label={effectiveCwd ? "Change folder" : "Choose folder"}
            title={effectiveCwd ?? undefined}
            onClick={() => setPicker({ hostId, initialPath: effectiveCwd ?? "" })}
            className="flex flex-1 min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden="true">
              <path d="M1 3.5A1.5 1.5 0 012.5 2h3.379a1.5 1.5 0 011.06.44l.622.621a.5.5 0 00.353.146H13.5A1.5 1.5 0 0115 4.707V12.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
            </svg>
            {effectiveCwd ? (
              // Right-to-left overflow keeps the end of a long path, which names the folder, in view.
              <span data-testid="terminal-folder" className="min-w-0 truncate text-left font-mono-code [direction:rtl]">
                <bdi>{effectiveCwd}</bdi>
              </span>
            ) : (
              <span className="whitespace-nowrap text-cc-fg font-medium">Choose folder</span>
            )}
          </button>
        </div>

        {host && !host.online && (
          <p
            data-testid="terminal-host-offline"
            role="status"
            className="px-3 py-1.5 text-xs text-cc-warning bg-cc-warning/10 border-b border-cc-border shrink-0"
          >
            {host.name} is offline: an open terminal continues when it reconnects.
          </p>
        )}

        <div className="flex-1 min-h-0">
          {effectiveCwd ? (
            <TerminalView cwd={effectiveCwd} sessionId={effectiveSessionId ?? undefined} hostId={hostId} embedded />
          ) : (
            <div className="h-full bg-cc-card flex items-center justify-center p-6 text-center">
              <p className="max-w-sm text-sm text-cc-muted">
                Choose a folder to start a terminal. You can switch folders or machines anytime.
              </p>
            </div>
          )}
        </div>
      </div>

      {picker && (
        <FolderPicker
          initialPath={picker.initialPath}
          recentDirsKey={recentDirsKeyFor(picker.hostId)}
          hostId={picker.hostId ?? undefined}
          onSelect={(path) => openFolder(path, picker.hostId)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
