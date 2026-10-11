import { useEffect, useState } from "react";
import { useRemoteHosts } from "../remote-hosts.js";
import { useStore } from "../store.js";
import {
  askSessionToSetUp,
  takeUserContentFocusRequest,
  USER_CONTENT_FOCUS_EVENT,
  useUserContentStatus,
  waitingCount,
} from "../user-content.js";
import { SettingsSubsection } from "./settings-controls.js";

/** Anchor the one-time notice scrolls to. */
export const USER_CONTENT_SECTION_ID = "settings-user-content";

/**
 * Entry point for the user's own instructions and skills, which Takode keeps
 * once on this server's machine and delivers to every machine. Setting them
 * up or migrating is an agent's job (the `takode-user-content` skill): here
 * the user only sees the state and hands the work to a session of their choice.
 */
export function SettingsUserContentSection({ hidden = false }: { hidden?: boolean }) {
  const status = useUserContentStatus();
  const { hosts, local } = useRemoteHosts();
  const sessions = useStore((state) => state.sdkSessions);
  const [sessionId, setSessionId] = useState("");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  /** Highlighted briefly after the one-time notice brought the user here. */
  const [focused, setFocused] = useState(false);
  const loaded = status !== null;

  // Scroll once the section has its content, so later layout changes on the page cannot move it out of view.
  useEffect(() => {
    if (!loaded) return;
    let again: ReturnType<typeof setTimeout> | undefined;
    let unhighlight: ReturnType<typeof setTimeout> | undefined;
    const focus = () => {
      if (!takeUserContentFocusRequest()) return;
      const scroll = () => document.getElementById(USER_CONTENT_SECTION_ID)?.scrollIntoView({ block: "start" });
      scroll();
      setFocused(true);
      again = setTimeout(scroll, 400);
      unhighlight = setTimeout(() => setFocused(false), 4000);
    };
    focus();
    window.addEventListener(USER_CONTENT_FOCUS_EVENT, focus);
    return () => {
      window.removeEventListener(USER_CONTENT_FOCUS_EVENT, focus);
      clearTimeout(again);
      clearTimeout(unhighlight);
    };
  }, [loaded]);

  const machineName = (hostId: string | null) =>
    hostId === null
      ? `${local?.name ?? "This machine"} (this machine)`
      : (hosts.find((host) => host.id === hostId)?.name ?? hostId);
  const choices = sessions
    .filter((session) => !session.archived)
    .sort((a, b) => (b.sessionNum ?? 0) - (a.sessionNum ?? 0));

  function send() {
    if (!sessionId) return;
    setError("");
    setSent("");
    askSessionToSetUp(sessionId)
      .then(() => {
        const session = choices.find((choice) => choice.sessionId === sessionId);
        setSent(`Sent to #${session?.sessionNum ?? ""} ${session?.name ?? ""}. Follow along in that session.`);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }

  return (
    <div
      id={USER_CONTENT_SECTION_ID}
      className={`scroll-mt-28 rounded-lg transition-shadow ${focused ? "ring-2 ring-cc-primary/60" : ""}`}
    >
      <SettingsSubsection
        title="Your Instructions and Skills"
        description="Takode can keep your instructions and skills once on this server's machine and give every machine's ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md and skill folders the same copy. An agent sets it up or migrates your existing files: it checks every machine, explains what it finds and asks you before replacing anything."
        hidden={hidden}
      >
        {status && (
          <div className="space-y-2 text-xs">
            <div className="text-cc-muted">
              {!status.storeExists || status.storeEmpty ? "Not set up yet. " : "Set up. "}
              Store: <span className="font-mono">{status.store.instructions}</span> and{" "}
              <span className="font-mono">{status.store.skills}</span>.
            </div>
            {!status.storeEmpty &&
              status.machines.map((machine) => {
                const waiting = waitingCount(machine);
                return (
                  <div key={machine.hostId ?? ""} className="text-cc-fg">
                    {machineName(machine.hostId)}:{" "}
                    <span className="text-cc-muted">
                      {machine.error
                        ? `could not deliver (${machine.error})`
                        : waiting
                          ? `${waiting} item${waiting === 1 ? "" : "s"} waiting for your approval`
                          : "up to date"}
                    </span>
                  </div>
                );
              })}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                aria-label="Session to set this up"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg"
              >
                <option value="">Pick a session to do this…</option>
                {choices.map((session) => (
                  <option key={session.sessionId} value={session.sessionId}>
                    #{session.sessionNum} {session.name ?? session.cwd}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!sessionId}
                onClick={send}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-cc-border text-cc-fg hover:bg-cc-hover disabled:opacity-50"
              >
                Ask this session to set it up
              </button>
            </div>
            <div className="text-cc-muted">To use a fresh session, create one first, then pick it here.</div>
            {sent && <div className="text-cc-fg">{sent}</div>}
            {error && <div className="text-cc-error">{error}</div>}
          </div>
        )}
      </SettingsSubsection>
    </div>
  );
}
