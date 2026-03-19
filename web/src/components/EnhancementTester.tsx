import { useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";

/**
 * Debug tool for testing the transcription enhancement pipeline.
 * Paste raw transcript text, pick a mode, and see the enhanced result
 * without having to re-record audio.
 */
export function EnhancementTester() {
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [mode, setMode] = useState<"default" | "bullet">("default");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    raw: string;
    enhanced: string;
    wasEnhanced: boolean;
    debug: { model: string; durationMs: number; skipReason?: string } | null;
  } | null>(null);

  const currentSessionId = useStore((s) => s.currentSessionId);
  const sessionNames = useStore((s) => s.sessionNames);
  const sessionName = currentSessionId ? sessionNames.get(currentSessionId) : null;

  async function handleRun() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api.testEnhancement(inputText, mode, currentSessionId ?? undefined);
      setResult({
        raw: inputText,
        enhanced: res.enhanced,
        wasEnhanced: res.wasEnhanced,
        debug: res.debug,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-cc-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left cursor-pointer"
      >
        <h2 className="text-sm font-semibold text-cc-fg">Enhancement Tester</h2>
        <span className="text-xs text-cc-muted">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-cc-muted">
            Test the enhancement pipeline on raw text without recording audio.
          </p>

          {/* Context indicator */}
          <p className="text-xs text-cc-muted">
            {currentSessionId
              ? <>Context: <span className="text-cc-fg font-medium">{sessionName || currentSessionId.slice(0, 8)}</span></>
              : "No active session -- running without conversation context"}
          </p>

          {/* Raw text input */}
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Paste raw transcript text here..."
            rows={4}
            className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 font-mono resize-y"
          />

          {/* Mode selector + Run button */}
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-cc-border overflow-hidden">
              <button
                type="button"
                onClick={() => setMode("default")}
                className={`px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                  mode === "default"
                    ? "bg-cc-primary text-white"
                    : "bg-cc-input-bg text-cc-muted hover:text-cc-fg"
                }`}
              >
                Prose
              </button>
              <button
                type="button"
                onClick={() => setMode("bullet")}
                className={`px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                  mode === "bullet"
                    ? "bg-cc-primary text-white"
                    : "bg-cc-input-bg text-cc-muted hover:text-cc-fg"
                }`}
              >
                Bullet Points
              </button>
            </div>

            <button
              type="button"
              onClick={handleRun}
              disabled={loading || !inputText.trim()}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cc-primary text-white hover:bg-cc-primary/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Running..." : "Run Enhancement"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-2">
              {/* Metadata */}
              <div className="flex items-center gap-3 text-xs text-cc-muted">
                {result.debug && (
                  <>
                    <span>Model: <span className="font-mono text-cc-fg">{result.debug.model}</span></span>
                    <span>{result.debug.durationMs}ms</span>
                  </>
                )}
                <span className={result.wasEnhanced ? "text-cc-success" : "text-cc-warning"}>
                  {result.wasEnhanced ? "enhanced" : result.debug?.skipReason ? `skipped: ${result.debug.skipReason}` : "not enhanced"}
                </span>
              </div>

              {/* Side-by-side comparison */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs font-medium text-cc-muted mb-1">Raw Input</p>
                  <pre className="p-3 text-xs font-mono bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                    {result.raw}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-cc-muted mb-1">Enhanced Output</p>
                  <pre className="p-3 text-xs font-mono bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                    {result.enhanced}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
