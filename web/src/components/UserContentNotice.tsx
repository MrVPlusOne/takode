import { USER_CONTENT_SECTION_ID } from "./SettingsUserContentSection.js";
import { useUserContentNotice } from "../user-content.js";

/**
 * One-time notice after an upgrade: Takode can now keep the user's
 * instructions and skills once and deliver them to every machine. Shown while
 * the store is empty and some machine has user-level files, until dismissed.
 */
export function UserContentNotice() {
  const { show, dismiss } = useUserContentNotice();
  if (!show) return null;
  function setUp() {
    window.location.hash = "#/settings";
    // The Settings page mounts on the hash change; scroll once it has rendered.
    setTimeout(() => document.getElementById(USER_CONTENT_SECTION_ID)?.scrollIntoView({ block: "start" }), 300);
  }
  return (
    <div className="px-4 py-2 border-b border-cc-border bg-cc-hover/60 text-xs flex items-center gap-3">
      <span className="flex-1 text-cc-fg">
        Takode can now keep your instructions and skills once and give every machine the same copy. Nothing changes
        until you set it up.
      </span>
      <button type="button" className="px-2.5 py-1 rounded-md border border-cc-border text-cc-fg" onClick={setUp}>
        Set up
      </button>
      <button type="button" className="px-2.5 py-1 rounded-md text-cc-muted" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
