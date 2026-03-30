import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { useStore } from "../store.js";
import { getUiTraceSnapshot, recordUiTrace } from "../utils/ui-crash-debug.js";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Capture the component stack for display in the fallback UI
    this.setState({ componentStack: info.componentStack ?? null });

    const state = useStore.getState();
    const currentSessionId = state.currentSessionId;
    const changedFilesCount = currentSessionId ? (state.changedFiles.get(currentSessionId)?.size ?? 0) : 0;
    const errorContext = {
      currentSessionId,
      activeTab: state.activeTab,
      reorderMode: state.reorderMode,
      sidebarOpen: state.sidebarOpen,
      taskPanelOpen: state.taskPanelOpen,
      sdkSessionCount: state.sdkSessions.length,
      changedFilesCount,
    };
    const trace = getUiTraceSnapshot().slice(-40);
    recordUiTrace("error.boundary", {
      message: error.message,
      context: errorContext,
      componentStack: info.componentStack,
    });
    console.error("[AppErrorBoundary]", error, info.componentStack, {
      context: errorContext,
      recentUiTrace: trace,
    });
  }

  render() {
    if (this.state.hasError) {
      const { error, componentStack } = this.state;
      const errorMessage = error?.message || "Unknown error";
      // Decode common minified React errors for readability
      const isMaxUpdateDepth = errorMessage.includes("185") || errorMessage.includes("Maximum update depth");
      const friendlyMessage = isMaxUpdateDepth
        ? "A UI component entered an infinite update loop (Maximum update depth exceeded)."
        : errorMessage;

      return (
        <div className="h-[100dvh] flex items-center justify-center bg-cc-bg text-cc-fg px-4">
          <div className="max-w-lg w-full rounded-xl border border-cc-border bg-cc-card p-5 shadow-sm">
            <h1 className="text-base font-semibold">A runtime error occurred</h1>
            <p className="text-sm text-cc-muted mt-2">{friendlyMessage}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center rounded-md bg-cc-primary px-3 py-1.5 text-sm text-white hover:bg-cc-primary-hover cursor-pointer"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null, componentStack: null })}
                className="inline-flex items-center rounded-md border border-cc-border px-3 py-1.5 text-sm text-cc-fg hover:bg-cc-hover cursor-pointer"
              >
                Retry
              </button>
            </div>
            {(errorMessage || componentStack) && (
              <details className="mt-4">
                <summary className="text-xs text-cc-muted cursor-pointer hover:text-cc-fg">Technical details</summary>
                <div className="mt-2 rounded-md bg-cc-code-bg border border-cc-border p-3 max-h-64 overflow-y-auto">
                  {errorMessage && (
                    <pre className="text-[11px] font-mono-code text-cc-error whitespace-pre-wrap break-words">
                      {errorMessage}
                    </pre>
                  )}
                  {componentStack && (
                    <pre className="text-[10px] font-mono-code text-cc-muted whitespace-pre-wrap break-words mt-2 border-t border-cc-border/50 pt-2">
                      {componentStack}
                    </pre>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
