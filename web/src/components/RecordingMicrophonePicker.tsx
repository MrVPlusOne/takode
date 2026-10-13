import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import type { VoiceMicrophone, VoiceMicrophoneSelection } from "../utils/voice-microphone.js";
import { TOUCH_MENU_ITEM_CLASS, useMenuButton } from "./ContextMenu.js";

/** Chooses an input from the recording row, keeping switch failures beside the current mic name. */
export function RecordingMicrophonePicker({
  label,
  selection,
}: {
  label: string | null | undefined;
  selection: VoiceMicrophoneSelection;
}) {
  const { menu, toggle, close } = useMenuButton();
  const menuRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  useOutsidePress([menuRef, menu?.anchor], close);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const element = menuRef.current;
    const anchor = menu.anchor.getBoundingClientRect();
    const top = anchor.top >= element.offsetHeight + 8 ? anchor.top - element.offsetHeight - 4 : anchor.bottom + 4;
    element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - element.offsetHeight - 8))}px`;
    element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - element.offsetWidth - 8))}px`;
  }, [menu, selection.inputs, loading]);

  useEffect(() => {
    if (!menu || (document.activeElement !== menu.anchor && document.activeElement !== document.body)) return;
    // Enumeration can fill an initially empty menu after it opens. Do not steal focus
    // from a choice the user has already reached while the device list refreshes.
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu, selection.inputs]);

  useEffect(() => {
    if (!menu) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      close();
      menu.anchor.focus();
    };
    // Escape dismisses this picker before the composer's Escape can cancel the recording.
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [menu, close]);

  async function select(microphone: VoiceMicrophone) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    close();
    try {
      const result = await selection.select(microphone);
      if (result === "next-recording")
        setNotice("Saved for the next recording. Live switching is unavailable in this browser.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not switch microphone. Your recording is continuing.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <button
        type="button"
        data-testid="voice-input-device-label"
        aria-label={`Choose microphone: ${label || "Microphone"}`}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-busy={busy}
        disabled={busy}
        title={`Microphone: ${label || "Unknown"}`}
        className="flex max-w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-cc-muted hover:text-cc-fg hover:bg-cc-hover cursor-pointer disabled:opacity-60"
        onClick={(event) => {
          toggle(event);
          if (menu) return;
          setLoading(true);
          void selection
            .refresh()
            .catch(() => setNotice("Could not refresh microphones. Try opening the list again."))
            .finally(() => setLoading(false));
        }}
      >
        <span className="truncate">{label || "Microphone"}</span>
        <span aria-hidden="true" className="shrink-0">
          {busy ? "…" : "▾"}
        </span>
      </button>
      {notice && (
        <p role="status" className="mt-1 text-xs text-cc-warning">
          {notice}
        </p>
      )}
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Microphones"
            data-context-menu="true"
            className="fixed z-[1300] w-max min-w-44 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-cc-border bg-cc-card py-1 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
            onKeyDown={(event) => {
              const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
              if (!keys.includes(event.key)) return;
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
              if (!buttons.length) return;
              event.preventDefault();
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
              buttons[next].focus();
            }}
          >
            {selection.inputs.map((microphone) => (
              <button
                key={microphone.deviceId}
                type="button"
                role="menuitem"
                onClick={() => void select(microphone)}
                className={`block w-full px-3 py-2 text-left text-xs text-cc-fg hover:bg-cc-hover cursor-pointer whitespace-normal break-words ${TOUCH_MENU_ITEM_CLASS}`}
              >
                {microphone.label}
              </button>
            ))}
            {selection.inputs.length === 0 && (
              <p className="px-3 py-2 text-xs text-cc-muted">
                {loading ? "Loading microphones…" : "No microphones are available."}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
