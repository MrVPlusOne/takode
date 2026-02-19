import { useStore } from "../store.js";

export function HomePage() {
  const serverName = useStore((s) => s.serverName);
  const backend = "claude"; // For logo display only
  const logoSrc = "/logo.svg";

  return (
    <div className="flex-1 h-full flex items-center justify-center px-3 sm:px-4">
      <div className="flex flex-col items-center gap-4 select-none">
        <img src={logoSrc} alt="Takode" className="w-24 h-24 sm:w-28 sm:h-28" />
        <h1 className="text-xl sm:text-2xl font-semibold text-cc-fg">
          {serverName || "Tako Code"}
        </h1>
        <p className="text-sm text-cc-muted text-center max-w-xs leading-relaxed">
          Create a new session to get started, or select an existing session from the sidebar.
        </p>
        <button
          onClick={() => useStore.getState().setShowNewSessionModal(true)}
          className="mt-2 flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors cursor-pointer"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M8 3v10M3 8h10" />
          </svg>
          New Session
        </button>
      </div>
    </div>
  );
}
