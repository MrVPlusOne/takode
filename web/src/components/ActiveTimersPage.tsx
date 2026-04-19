import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ActiveTimerSession } from "../api.js";
import { SessionInlineLink } from "./SessionInlineLink.js";

function formatRelativeTime(epochMs: number): string {
  const diffMs = epochMs - Date.now();
  if (diffMs <= 0) return "firing...";
  const totalSeconds = Math.ceil(diffMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  return `${hours}h ${remainMins}m`;
}

function describeTimer(timer: ActiveTimerSession["timers"][number]): string | null {
  if (timer.type === "recurring") return `every ${timer.originalSpec}`;
  if (timer.type === "at") return `at ${timer.originalSpec}`;
  return null;
}

function getSessionLabel(session: ActiveTimerSession): string {
  if (session.sessionNum != null) return `#${session.sessionNum}`;
  return session.name?.trim() || session.sessionId.slice(0, 8);
}

function TimerRow({
  timer,
}: {
  timer: ActiveTimerSession["timers"][number];
}) {
  const scheduleLabel = describeTimer(timer);

  return (
    <div className="rounded-xl border border-cc-border bg-cc-card/70 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-cc-fg break-words">{timer.title}</p>
          {timer.description && (
            <p className="text-xs leading-relaxed text-cc-muted whitespace-pre-wrap">{timer.description}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-mono-code text-cc-fg">next in {formatRelativeTime(timer.nextFireAt)}</div>
          {scheduleLabel && <div className="mt-1 text-[11px] text-cc-muted">{scheduleLabel}</div>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-cc-muted">
        <span>{timer.id}</span>
      </div>
    </div>
  );
}

export function ActiveTimersPage({ embedded = false }: { embedded?: boolean }) {
  const [sessions, setSessions] = useState<ActiveTimerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    setError("");
    return api
      .listActiveTimers()
      .then(setSessions)
      .catch((err: unknown) => {
        setSessions([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (sessions.length === 0) return;
    const interval = setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => clearInterval(interval);
  }, [sessions.length]);

  const timerCount = useMemo(() => sessions.reduce((sum, session) => sum + session.timers.length, 0), [sessions]);

  const content = (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-cc-error/20 bg-cc-error/10 px-4 py-3 text-sm text-cc-error">{error}</div>
      )}
      {loading ? (
        <div className="rounded-xl border border-cc-border bg-cc-card px-4 py-10 text-center text-sm text-cc-muted">
          Loading active timers...
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-cc-border bg-cc-card px-4 py-10 text-center text-sm text-cc-muted">
          No active timers across sessions.
        </div>
      ) : (
        <section className="rounded-2xl border border-cc-border bg-cc-card/90 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-cc-fg">Current Timers</h2>
              <p className="mt-1 text-xs text-cc-muted">
                {timerCount} timer{timerCount !== 1 ? "s" : ""} across {sessions.length} session
                {sessions.length !== 1 ? "s" : ""}.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {sessions.map((session) => (
              <section key={session.sessionId} className="rounded-2xl border border-cc-border bg-cc-bg/60 p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono-code text-cc-primary">{getSessionLabel(session)}</span>
                      <SessionInlineLink
                        sessionId={session.sessionId}
                        sessionNum={session.sessionNum}
                        className="min-w-0 truncate text-left text-sm font-medium text-cc-fg hover:text-cc-primary transition-colors"
                      >
                        {session.name || session.sessionId}
                      </SessionInlineLink>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          session.backendType === "codex"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-[#5BA8A0]/10 text-[#5BA8A0]"
                        }`}
                      >
                        {session.backendType === "codex" ? "Codex" : "Claude"}
                      </span>
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-cc-muted">
                        {session.cliConnected ? session.state : "disconnected"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-cc-muted">
                      {session.gitBranch && <span className="font-mono-code">{session.gitBranch}</span>}
                      <span className="font-mono-code" title={session.cwd}>
                        {session.cwd}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-cc-muted">
                    {session.timers.length} timer{session.timers.length !== 1 ? "s" : ""}
                  </div>
                </div>
                <div className="space-y-3">
                  {session.timers.map((timer) => (
                    <TimerRow key={`${session.sessionId}:${timer.id}`} timer={timer} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  if (!embedded) return content;

  return (
    <div className="h-full bg-cc-bg overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-cc-fg">Active Timers</h1>
          <p className="mt-1 text-sm text-cc-muted">See which sessions are waiting on timers and jump back into the right conversation fast.</p>
        </div>
        {content}
      </div>
    </div>
  );
}
