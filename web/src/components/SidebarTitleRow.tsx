import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import { useStore } from "../store.js";
import { NavigationButtons } from "./NavigationButtons.js";

const LOGO_SRC = "/app-logo.png";

/**
 * The sessions panel's top row: the app logo, the server name (click to rename this server), and
 * on desktop Back, Forward and Recently viewed. `compact` is the row's form in the folded panel,
 * where it shares the top bar's height, so the logo is smaller.
 */
export function SidebarTitleRow({ compact = false }: { compact?: boolean }) {
  const serverName = useStore((s) => s.serverName);
  const isDesktopLayout = useDesktopShellLayout();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function confirmEdit() {
    const trimmed = draft.trim();
    useStore.getState().setServerName(trimmed);
    api.updateSettings({ serverName: trimmed }).catch(() => {});
    setEditing(false);
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <img
        src={LOGO_SRC}
        alt=""
        className={`shrink-0 object-contain ${compact ? "h-8 w-8 rounded-lg" : "h-12 w-12 rounded-xl"}`}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={confirmEdit}
          className="text-sm font-semibold text-cc-fg tracking-tight bg-cc-input-bg border border-cc-border rounded px-1.5 py-0.5 outline-none focus:border-cc-primary/60 min-w-0 w-[140px]"
          placeholder="Takode"
          maxLength={30}
        />
      ) : (
        <span
          data-sidebar-server-name
          onClick={() => {
            setDraft(serverName || "");
            setEditing(true);
          }}
          className="min-w-0 truncate text-sm font-semibold text-cc-fg tracking-tight cursor-pointer hover:text-cc-primary transition-colors"
          title="Click to rename this server instance"
        >
          {serverName || "Takode"}
        </span>
      )}
      <button
        type="button"
        onClick={() => useStore.getState().setSidebarOpen(false)}
        className="sm:hidden ml-auto inline-flex items-center justify-center w-9 h-9 rounded-full border border-cc-border/70 bg-cc-hover/50 text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
        aria-label="Dismiss sidebar"
        title="Dismiss sidebar"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
      {import.meta.env.DEV && (
        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 leading-none">
          Dev
        </span>
      )}
      {isDesktopLayout && (
        <div className="ml-auto">
          <NavigationButtons />
        </div>
      )}
    </div>
  );
}
