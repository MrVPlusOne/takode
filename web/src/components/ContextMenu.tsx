import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Shared styles for menu containers and items, extracted to avoid duplication.
const MENU_STYLES = {
  container: "fixed z-50 bg-cc-card border border-cc-border rounded-lg shadow-lg overflow-visible",
  submenuContainer:
    "fixed z-[60] w-fit min-w-[120px] max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-y-auto bg-cc-card border border-cc-border rounded-lg shadow-lg py-1",
  item: "w-full max-w-[calc(100vw-1rem)] sm:max-w-80 truncate px-2.5 py-1.5 text-left text-[11px] text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer whitespace-nowrap",
  disabledItem:
    "w-full max-w-72 whitespace-normal break-words px-2.5 py-1.5 text-left text-[11px] text-cc-muted font-mono-code leading-relaxed",
} as const;

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Nested submenu items -- renders as a hover-expanded child menu. */
  children?: ContextMenuItem[];
  confirm?: {
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
  };
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  widthClassName?: string;
  itemClassName?: string;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  widthClassName = "w-fit min-w-[120px]",
  itemClassName = "",
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmingItem, setConfirmingItem] = useState<ContextMenuItem | null>(null);
  const [expandedSubmenu, setExpandedSubmenu] = useState<number | null>(null);

  useEffect(() => {
    function handleDismiss(e: Event) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (confirmingItem) {
          setConfirmingItem(null);
        } else if (expandedSubmenu !== null) {
          setExpandedSubmenu(null);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("mousedown", handleDismiss);
    document.addEventListener("touchstart", handleDismiss);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDismiss);
      document.removeEventListener("touchstart", handleDismiss);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, confirmingItem, expandedSubmenu]);

  // Clamp to viewport bounds
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const el = menuRef.current;
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [x, y, confirmingItem]);

  // Portal to document.body so the menu escapes overflow-hidden ancestors
  // and the CSS transform containing block on the root layout div.
  return createPortal(
    <div ref={menuRef} className={`${MENU_STYLES.container} ${widthClassName}`} style={{ left: x, top: y }}>
      {confirmingItem ? (
        <div className="p-3 w-56">
          <p className="text-xs text-cc-fg mb-1 font-medium">{confirmingItem.confirm!.title}</p>
          <p className="text-[11px] text-cc-muted mb-3 leading-relaxed">{confirmingItem.confirm!.description}</p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setConfirmingItem(null)}
              className="px-2.5 py-1 text-[11px] rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                confirmingItem.onClick();
                onClose();
              }}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-colors cursor-pointer font-medium ${
                confirmingItem.confirm!.destructive
                  ? "bg-red-500/15 text-red-500 hover:bg-red-500/25"
                  : "bg-cc-primary/15 text-cc-primary hover:bg-cc-primary/25"
              }`}
            >
              {confirmingItem.confirm!.confirmLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="py-1">
          {items.map((item, idx) =>
            item.disabled ? (
              <div key={`${item.label}-${idx}`} className={MENU_STYLES.disabledItem}>
                {item.label}
              </div>
            ) : item.children && item.children.length > 0 ? (
              <SubmenuItem
                key={`${item.label}-${idx}`}
                item={item}
                isOpen={expandedSubmenu === idx}
                onOpen={() => setExpandedSubmenu(idx)}
                onClose={() => setExpandedSubmenu(null)}
                onAction={(child) => {
                  try {
                    child.onClick();
                  } catch (e) {
                    console.error("Submenu action error:", e);
                  }
                  onClose();
                }}
                itemClassName={itemClassName}
              />
            ) : (
              <button
                key={`${item.label}-${idx}`}
                onClick={() => {
                  if (item.confirm) {
                    setConfirmingItem(item);
                  } else {
                    try {
                      item.onClick();
                    } catch (e) {
                      console.error("Menu action error:", e);
                    }
                    onClose();
                  }
                }}
                onMouseEnter={() => setExpandedSubmenu(null)}
                className={`${MENU_STYLES.item} ${itemClassName}`}
                title={item.label}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** A menu item that opens a submenu on hover/click. */
function SubmenuItem({
  item,
  isOpen,
  onOpen,
  onClose,
  onAction,
  itemClassName,
}: {
  item: ContextMenuItem;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAction: (child: ContextMenuItem) => void;
  itemClassName?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);

  // Position from the rendered submenu dimensions so long quest titles and
  // dense target lists remain inside narrow mobile viewports.
  const [subStyle, setSubStyle] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (!isOpen || !rowRef.current || !subRef.current) return;
    const rowRect = rowRef.current.getBoundingClientRect();
    const subRect = subRef.current.getBoundingClientRect();
    let left = rowRect.right + 2;
    if (left + subRect.width > window.innerWidth - 8) {
      left = Math.max(8, rowRect.left - subRect.width - 2);
    }
    const top = Math.max(8, Math.min(rowRect.top, window.innerHeight - subRect.height - 8));
    setSubStyle({ position: "fixed", left, top });
  }, [isOpen, item.children?.length]);

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={(e) => {
        // Don't close if moving into the submenu panel
        if (subRef.current?.contains(e.relatedTarget as Node)) return;
        onClose();
      }}
    >
      <button
        onClick={onOpen}
        className={`${MENU_STYLES.item} ${itemClassName ?? ""} flex items-center justify-between`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={item.label}
      >
        <span>{item.label}</span>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-2.5 h-2.5 ml-2 opacity-50"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>
      {isOpen && item.children && (
        <div ref={subRef} className={MENU_STYLES.submenuContainer} style={subStyle} onMouseLeave={() => onClose()}>
          {item.children.map((child, ci) => (
            <button
              key={`${child.label}-${ci}`}
              onClick={() => onAction(child)}
              className={`${MENU_STYLES.item} ${itemClassName ?? ""}`}
              title={child.label}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
