import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchReadAloudRecordAudio,
  getReadAloudRecord,
  listReadAloudRecords,
  replayReadAloudRecord,
  type ReadAloudRecord,
  type ReadAloudRecordDetail,
  type ReadAloudRecordSummary,
} from "../api/read-aloud.js";
import { usePendingAction } from "../hooks/usePendingAction.js";

/**
 * Settings > Voice Input > Read Aloud Debug: every read aloud with its exact rewrite
 * prompts, rewrite answer, spoken text, settings and audio, and a form to read the
 * same message again with another voice, speaking style, rewrite model or prompt.
 */
export function ReadAloudDebugPanel() {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<ReadAloudRecordSummary[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError("");
    listReadAloudRecords()
      .then(setRecords)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const toggleOpen = () => {
    setOpen(!open);
    if (!open && records === null) refresh();
  };

  return (
    <div>
      <button type="button" onClick={toggleOpen} className="flex w-full items-center justify-between text-left">
        <h2 className="text-sm font-semibold text-cc-fg">Read Aloud Debug</h2>
        <span className="text-xs text-cc-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-cc-muted">
              Recent reads with their prompts and audio.{records ? ` Showing ${records.length}.` : ""}
            </p>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="rounded px-2 py-1 text-xs text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
          {error && <ErrorBox message={error} />}
          {records?.length === 0 && <p className="text-xs text-cc-muted">Nothing read aloud yet.</p>}
          {records && records.length > 0 && (
            <div className="max-h-[400px] space-y-1 overflow-y-auto">
              {records.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedId(record.id)}
                  className="block w-full rounded-lg border border-cc-border px-3 py-2 text-left text-xs hover:bg-cc-hover"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="w-16 shrink-0 text-cc-muted">{timeAgo(record.timestamp)}</span>
                    <span className="font-mono text-[10px] text-cc-fg">{record.voice}</span>
                    {record.error ? (
                      <span className="flex-1 truncate text-cc-error">failed</span>
                    ) : (
                      <span className={`flex-1 ${record.keptOriginal ? "text-cc-muted" : "text-cc-success"}`}>
                        {record.keptOriginal ? "read as written" : "rewritten"}
                      </span>
                    )}
                    <span className="text-cc-muted">
                      {formatMs(record.rewriteMs)} + {formatMs(record.speechMs)}
                    </span>
                    {record.replayCount > 0 && (
                      <span className="text-cc-muted">
                        {record.replayCount} {record.replayCount === 1 ? "replay" : "replays"}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-cc-muted">{record.previewText}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {selectedId !== null && <ReadAloudRecordDialog id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function ReadAloudRecordDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ReadAloudRecordDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getReadAloudRecord(id)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Read Aloud Detail"
        className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1100px] flex-col rounded-xl border border-cc-border bg-cc-bg shadow-2xl sm:h-[calc(100dvh-48px)] sm:w-[calc(100vw-48px)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-cc-border px-4 py-3">
          <h3 className="text-sm font-semibold text-cc-fg">Read Aloud Detail</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          >
            Close
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error && <ErrorBox message={error} />}
          {!detail && !error && <p className="text-sm text-cc-muted">Loading...</p>}
          {detail && (
            <>
              <ReadAloudRun record={detail.record} label="Original read" open />
              <TryOtherSettings
                detail={detail}
                onReplay={(replay) => setDetail({ ...detail, replays: [...detail.replays, replay] })}
              />
              {[...detail.replays].reverse().map((replay, index) => (
                <ReadAloudRun
                  key={replay.id}
                  record={replay}
                  label={`Replay ${detail.replays.length - index}`}
                  open={index === 0}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One read: its settings, audio, prompts and texts. */
function ReadAloudRun({ record, label, open }: { record: ReadAloudRecord; label: string; open: boolean }) {
  const { trace } = record;
  const { settings } = trace;
  return (
    <section className="space-y-2 rounded-lg border border-cc-border p-3" data-testid="read-aloud-debug-run">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold text-cc-fg">{label}</span>
        <span className="text-cc-muted">{new Date(record.timestamp).toLocaleString()}</span>
        <span className="text-cc-muted">
          Voice <span className="font-mono text-cc-fg">{settings.voice}</span>
        </span>
        <span className="text-cc-muted">
          Speech <span className="font-mono text-cc-fg">{settings.ttsModel}</span> {formatMs(trace.speechMs)} in{" "}
          {trace.speechParts} {trace.speechParts === 1 ? "part" : "parts"}
        </span>
        <span className="text-cc-muted">
          {settings.rewriteSystemPrompt === null ? (
            "Rewrite skipped"
          ) : (
            <>
              Rewrite <span className="font-mono text-cc-fg">{settings.rewriteModel}</span>{" "}
              {trace.rewriteCached ? "reused from an identical earlier rewrite" : formatMs(trace.rewriteMs)}
            </>
          )}
        </span>
      </div>
      {record.error ? <ErrorBox message={record.error} /> : <RecordAudio id={record.id} />}
      <TextBlock title="Spoken text" text={trace.spokenText || "(none)"} open={open} />
      <TextBlock title="Speaking style" text={settings.voiceStyle || "(none)"} />
      {settings.rewriteSystemPrompt !== null && (
        <>
          <TextBlock title="Rewrite answer (as returned)" text={trace.rewriteOutput ?? "(none)"} />
          <TextBlock title="Rewrite system prompt" text={settings.rewriteSystemPrompt} />
          <TextBlock title="Rewrite user prompt (message and context)" text={trace.rewriteUserPrompt ?? "(none)"} />
        </>
      )}
      {label === "Original read" && <TextBlock title="Message as shown" text={record.messageText} />}
    </section>
  );
}

function TryOtherSettings({
  detail,
  onReplay,
}: {
  detail: ReadAloudRecordDetail;
  onReplay: (record: ReadAloudRecord) => void;
}) {
  const base = detail.record.trace.settings;
  const [voice, setVoice] = useState(base.voice);
  const [voiceStyle, setVoiceStyle] = useState(base.voiceStyle);
  const [rewriteModel, setRewriteModel] = useState(base.rewriteModel);
  const [skipRewrite, setSkipRewrite] = useState(base.rewriteSystemPrompt === null);
  const [prompt, setPrompt] = useState(base.rewriteSystemPrompt ?? detail.defaults.rewriteSystemPrompt ?? "");
  const replay = usePendingAction("Read again failed.");

  const run = () =>
    void replay.run(async () => {
      onReplay(
        await replayReadAloudRecord(detail.record.id, {
          voice,
          voiceStyle,
          rewriteModel,
          rewriteSystemPrompt: skipRewrite ? null : prompt,
        }),
      );
    });

  return (
    <section className="space-y-2 rounded-lg border border-cc-primary/40 p-3">
      <h4 className="text-xs font-semibold text-cc-fg">Read the same message with other settings</h4>
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-2 text-cc-muted">
          Voice
          <select
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
            className="rounded border border-cc-border bg-cc-input-bg px-2 py-1 text-cc-fg"
          >
            {detail.voices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-cc-muted">
          Rewrite model
          <input
            value={rewriteModel}
            onChange={(event) => setRewriteModel(event.target.value)}
            disabled={skipRewrite}
            className="w-32 rounded border border-cc-border bg-cc-input-bg px-2 py-1 font-mono text-cc-fg disabled:opacity-50"
          />
        </label>
        <label className="flex items-center gap-2 text-cc-muted">
          <input type="checkbox" checked={skipRewrite} onChange={(event) => setSkipRewrite(event.target.checked)} />
          Skip the rewrite
        </label>
      </div>
      <label className="block text-xs text-cc-muted">
        Speaking style
        <textarea
          value={voiceStyle}
          onChange={(event) => setVoiceStyle(event.target.value)}
          rows={2}
          className="mt-1 block w-full rounded border border-cc-border bg-cc-input-bg px-2 py-1 text-cc-fg"
        />
      </label>
      {!skipRewrite && (
        <label className="block text-xs text-cc-muted">
          Rewrite system prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={10}
            className="mt-1 block w-full rounded border border-cc-border bg-cc-input-bg px-2 py-1 font-mono text-[11px] text-cc-fg"
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          aria-busy={replay.pending || undefined}
          className="rounded-lg bg-cc-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cc-primary-hover"
        >
          {replay.pending ? "Reading..." : "Read again"}
        </button>
        {replay.error && <span className="text-xs text-cc-error">{replay.error}</span>}
      </div>
    </section>
  );
}

/** Plays a record's audio from a blob, so it works without range requests. */
function RecordAudio({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchReadAloudRecordAudio(id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (error) return <ErrorBox message={error} />;
  if (!url) return <p className="text-xs text-cc-muted">Loading audio...</p>;
  return <audio controls src={url} className="w-full" />;
}

function TextBlock({ title, text, open = false }: { title: string; text: string; open?: boolean }) {
  return (
    <details open={open} className="rounded border border-cc-border">
      <summary className="cursor-pointer px-2 py-1 text-xs text-cc-muted">{title}</summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-cc-border px-2 py-1.5 font-mono text-[11px] text-cc-fg">
        {text}
      </pre>
    </details>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-cc-error/20 bg-cc-error/10 px-3 py-2 text-xs text-cc-error">{message}</div>
  );
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
