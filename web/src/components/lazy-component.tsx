import { type ComponentType, lazy, Suspense } from "react";

/**
 * Load a rarely used page or heavy component on first use instead of with the startup bundle.
 *
 * After Restart Server, a tab still running the previous build may ask for a chunk the new
 * server no longer has; it then shows a Reload prompt instead of crashing the app.
 */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Lazy = lazy(() =>
    load().then(
      (component) => ({ default: component }),
      (error: unknown) => {
        console.error("[lazy-component] failed to load a code chunk:", error);
        return { default: ChunkReloadPrompt as ComponentType<P> };
      },
    ),
  );
  return function LazyComponent(props: P) {
    return (
      <Suspense fallback={<div className="h-full w-full" aria-busy="true" />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

function ChunkReloadPrompt() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-cc-muted">
      <span>This part of Takode could not be loaded, usually because the server was updated.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-cc-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        Reload
      </button>
    </div>
  );
}
