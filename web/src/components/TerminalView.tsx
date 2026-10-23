import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { connectTerminal, sendTerminalInput, sendTerminalResize, disconnectTerminal } from "../terminal-ws.js";
import { useLongPress } from "../hooks/useLongPress.js";
import { isTouchDevice } from "../utils/mobile.js";
import { ContextMenu } from "./ContextMenu.js";

interface TerminalViewProps {
  cwd: string;
  sessionId?: string;
  /** Machine the shell runs on: a registered remote host, or null for this server's machine. */
  hostId?: string | null;
  onClose?: () => void;
  /** Render only the terminal surface; the embedding page draws the frame and its header. */
  embedded?: boolean;
}

function getTerminalTheme(dark: boolean) {
  return {
    background: dark ? "#141413" : "#1e1e1e",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    selectionBackground: "rgba(255, 255, 255, 0.2)",
  };
}

export function TerminalView({ cwd, sessionId, hostId = null, onClose, embedded = false }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const darkMode = useStore((s) => s.darkMode);
  const [pasteMenu, setPasteMenu] = useState<{ x: number; y: number } | null>(null);
  // Touch screens get no paste menu of their own: xterm types through a tiny
  // hidden textarea that a long-press never lands on. Desktop keeps the
  // browser's right-click menu, which xterm already wires to that textarea.
  const longPress = useLongPress(isTouchDevice() ? (x, y) => setPasteMenu({ x, y }) : undefined, {
    anchor: "press",
  });

  // Main effect: create xterm + connect to PTY — only depends on cwd
  useEffect(() => {
    if (!terminalRef.current) return;

    let cancelled = false;

    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Courier New', monospace",
      theme: getTerminalTheme(useStore.getState().darkMode),
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(terminalRef.current);

    xtermRef.current = xterm;
    fitRef.current = fit;

    function wireUp(terminalId: string) {
      if (cancelled) return;
      useStore.getState().setTerminalId(terminalId);

      connectTerminal(
        terminalId,
        (data) => xterm.write(data),
        (exitCode) => {
          xterm.writeln(`\r\n[Process exited with code ${exitCode}]`);
        },
        (errMsg) => {
          xterm.writeln(`\r\n[${errMsg}]`);
        },
        () => {
          // WebSocket is now open — send the actual fitted dimensions
          fit.fit();
          sendTerminalResize(xterm.cols, xterm.rows);
        },
      );
    }

    // Try to reconnect to an existing terminal for this session, folder and machine, else spawn new.
    api
      .getTerminal(sessionId)
      .then((info) => {
        if (cancelled) return;
        if (info.active && info.terminalId && info.cwd === cwd && (info.hostId ?? null) === hostId) {
          // Reconnect to existing terminal
          wireUp(info.terminalId);
        } else {
          // Spawn a new terminal
          return api.spawnTerminal(cwd, xterm.cols, xterm.rows, sessionId, hostId).then(({ terminalId }) => {
            wireUp(terminalId);
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        xterm.writeln(`\r\n[Failed to start terminal: ${err.message}]`);
      });

    // Forward xterm input to server
    const inputDisposable = xterm.onData((data) => sendTerminalInput(data));

    // Handle resize — also handles initial sizing once layout is ready
    const container = terminalRef.current;
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      sendTerminalResize(xterm.cols, xterm.rows);
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      // Only disconnect the WebSocket — leave the server terminal alive
      disconnectTerminal();
      xterm.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [cwd, sessionId, hostId]);

  // Separate effect: update theme without recreating the terminal
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getTerminalTheme(darkMode);
    }
  }, [darkMode]);

  const pasteFromClipboard = () => {
    // Must start inside the menu tap: iOS only reads the clipboard during a
    // user gesture, and asks the user to confirm with its own Paste bubble.
    navigator.clipboard
      .readText()
      .then((text) => xtermRef.current?.paste(text))
      .catch((err) => console.warn("Terminal paste failed:", err));
  };

  const background = getTerminalTheme(darkMode).background;
  const terminalSurface = (
    <>
      <div ref={terminalRef} data-testid="terminal-surface" className="flex-1 min-h-0 p-1" {...longPress.handlers} />
      {pasteMenu && (
        <ContextMenu
          x={pasteMenu.x}
          y={pasteMenu.y}
          items={[{ label: "Paste", onClick: pasteFromClipboard }]}
          onClose={() => setPasteMenu(null)}
        />
      )}
    </>
  );
  if (embedded) {
    return (
      <div className="h-full flex flex-col" style={{ background }}>
        {terminalSurface}
      </div>
    );
  }

  const terminalFrame = (
    <div
      className="flex flex-col rounded-[14px] shadow-2xl overflow-hidden border border-cc-border w-[90vw] max-w-4xl h-[70vh]"
      style={{ background }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-cc-border bg-cc-sidebar shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4 text-cc-muted shrink-0">
            <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm2 1.5l3 2.5-3 2.5V4.5zM8.5 10h3v1h-3v-1z" />
          </svg>
          <span className="text-xs text-cc-muted font-mono-code truncate">{cwd}</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer shrink-0"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Terminal container */}
      {terminalSurface}
    </div>
  );

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">{terminalFrame}</div>;
}
