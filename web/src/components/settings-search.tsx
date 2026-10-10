import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { sessionSearchTextMatches } from "../store-session-search.js";

type SettingItemMeta = {
  id: string;
  text: string;
  aliases?: string[];
  /** Subsection that shows this item; a subsection stays visible while any of its items match. */
  subsection?: string;
};

export type SettingsSectionId =
  | "appearance"
  | "keyboard"
  | "voice"
  | "notifications"
  | "sessions"
  | "cli"
  | "performance"
  | "hosts"
  | "server";

export type SettingsSectionMeta = {
  id: SettingsSectionId;
  title: string;
  description?: string;
  aliases?: string[];
  items: SettingItemMeta[];
};

export type SettingsSearchResults = {
  query: string;
  hasQuery: boolean;
  totalMatches: number;
  visibleSectionIds: Set<SettingsSectionId>;
  sectionMatchCounts: Map<SettingsSectionId, number>;
  /** Matching item ids plus the subsection keys of matching items. */
  visibleItemIds: Map<SettingsSectionId, Set<string>>;
};

/**
 * The top-level Settings groups, in page order. Group names should let someone
 * guess where a setting lives without opening the page, so prefer a concrete
 * name for a small group over a broad bucket such as "System".
 */
export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme, size, how chat content is displayed, and leader profile pictures.",
    aliases: ["display", "dark", "light", "sidebar", "diff", "quiet mode", "focus mode", "tools"],
    items: [
      { id: "theme", text: "Theme color scheme dark light VS Code appearance" },
      { id: "zoom", text: "Zoom display scale text size" },
      {
        id: "chat-line-height",
        text: "Chat Message Line Height message markdown density leading spacing",
      },
      {
        id: "compact-tool-activity",
        text: "Compact Tool Activity quiet focus mode collapse tool calls commands reads searches",
      },
      { id: "edit-blocks", text: "Expand Edit/Write Blocks diffs tool blocks" },
      {
        id: "usage-bars",
        text: "Usage Bars in Sidebar tokens sidebar usage limits",
      },
      {
        id: "leader-profiles",
        text: "Leader Profile Pictures portraits avatars picture sets Tako Shmi",
        aliases: ["portrait", "avatar", "profile"],
      },
    ],
  },
  {
    id: "keyboard",
    title: "Keyboard",
    description: "Which key sends a message, and keyboard shortcuts for app actions.",
    aliases: ["keys", "hotkeys", "typing", "composer"],
    items: [
      {
        id: "send-key",
        text: "Send Key Enter Shift+Enter Cmd+Enter Ctrl+Enter new line newline submit save comment",
      },
      {
        id: "shortcuts-enabled",
        text: "Keyboard Shortcuts enabled hotkeys",
        subsection: "shortcuts",
      },
      {
        id: "shortcuts-preset",
        text: "Preset standard vscode vim shortcut preset",
        aliases: ["vscode"],
        subsection: "shortcuts",
      },
      {
        id: "shortcuts-bindings",
        text: "Record shortcut override actions reset bindings universal search toggle sidebar terminal previous next new session voice",
        subsection: "shortcuts",
      },
    ],
  },
  {
    id: "voice",
    title: "Voice Input",
    description: "Speech-to-text for dictating messages, with optional cleanup by an LLM.",
    aliases: ["dictation", "microphone", "speech"],
    items: [
      {
        id: "voice-credentials",
        text: "Voice Transcription API Key Base URL OpenAI Whisper stt speech transcribe audio",
      },
      { id: "voice-models", text: "STT Model Enhancement Model expected languages hints" },
      { id: "voice-enhancement", text: "Enhancement Style prose bullet points" },
      { id: "voice-vocabulary", text: "Custom Vocabulary terms model mishears vocabulary hints" },
      { id: "voice-tester", text: "Enhancement Tester debug panel" },
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "Alerts in this browser and on your phone.",
    aliases: ["alerts", "push", "phone", "notify"],
    items: [
      {
        id: "sound",
        text: "Sound notification audio alerts",
        subsection: "browser",
      },
      {
        id: "desktop-alerts",
        text: "Desktop Alerts browser notifications permission",
        subsection: "browser",
      },
      {
        id: "phone-event-types",
        text: "Phone alert event types needs user input ready for review notify me errors filters",
        subsection: "phone-alerts",
      },
      {
        id: "phone-delay",
        text: "Phone alert delay seconds before sending",
        subsection: "phone-alerts",
      },
      {
        id: "web-push",
        text: "Web Push enable on this device iPhone Home Screen subscribed devices send test",
        subsection: "web-push",
      },
      {
        id: "pushover-credentials",
        text: "Pushover User Key API Token Base URL credentials pushover.net",
        subsection: "pushover",
      },
      {
        id: "pushover-enabled",
        text: "Send Pushover alerts enabled",
        subsection: "pushover",
      },
      {
        id: "pushover-test",
        text: "Pushover Send Test save configured",
        subsection: "pushover",
      },
    ],
  },
  {
    id: "sessions",
    title: "Sessions",
    description: "Defaults for new sessions, automatic naming, environments, and moving sessions between machines.",
    aliases: ["defaults", "leader", "worker"],
    items: [
      {
        id: "session-defaults",
        text: "Session Defaults Worker Defaults Leader Defaults use same as worker model speed service tier reasoning effort internet max context permission mode global usable context estimate",
      },
      {
        id: "codex-leader-mode",
        text: "Codex Leader Context Mode recycle compaction compact",
      },
      {
        id: "namer-enabled",
        text: "Session Namer auto-name sessions enabled names",
        subsection: "session-namer",
      },
      {
        id: "namer-backend",
        text: "Namer Backend Claude CLI OpenAI-compatible API",
        subsection: "session-namer",
      },
      {
        id: "namer-model",
        text: "Namer Model API Key Base URL naming backend",
        subsection: "session-namer",
      },
      {
        id: "namer-debug",
        text: "Session Namer Debug logs",
        subsection: "session-namer",
      },
      {
        id: "environments",
        text: "Manage Environments environment variables profiles",
      },
      {
        id: "session-data",
        text: "Export and Import Sessions Export All Sessions portable archive backup other machine paths",
      },
    ],
  },
  {
    id: "cli",
    title: "Editor",
    description: "Which editor opens file links.",
    items: [
      {
        id: "editor",
        text: "File Link Editor VSCode local remote Cursor none editor",
        aliases: ["vscode"],
      },
    ],
  },
  {
    id: "performance",
    title: "Performance & Power",
    description: "How many sessions stay running, git refresh load, and keeping your Mac awake.",
    aliases: ["resources", "memory", "speed", "battery"],
    items: [
      {
        id: "max-keep-alive",
        text: "Max Keep-Alive live CLI processes idle sessions",
      },
      {
        id: "heavy-repo",
        text: "Heavy Repo Mode cached session rows git metadata large repos slow filesystems",
      },
      {
        id: "sleep-inhibitor",
        text: "Prevent Sleep During Generation caffeinate awake macOS grace period",
      },
    ],
  },
  {
    id: "hosts",
    title: "Hosts",
    description:
      "This server's machine and other machines that run sessions, their names, and the Claude Code and Codex programs each one runs.",
    aliases: ["remote", "machine", "devbox", "backend", "binary", "path", "cli"],
    items: [
      {
        id: "hosts",
        text: "Hosts this machine local other machines remote devbox takode node token coordinator add host remove online offline Claude Code Codex binary path command auto-detect CLI keep sessions running survive server restart local node",
      },
    ],
  },
  {
    id: "server",
    title: "Server & Login",
    description: "Browser login password, server identity, time zone, logs, release notes, and restart.",
    aliases: ["diagnostics", "server", "security", "access"],
    items: [
      {
        id: "login",
        text: "Login password browser log in log out sign out devices security access remote phone",
        aliases: ["password", "security"],
      },
      {
        id: "server-time-zone",
        text: "Time Zone server timezone TZ IANA local time clock hours chat source tags herd timers UTC",
        aliases: ["timezone", "clock"],
      },
      {
        id: "server-slug",
        text: "Server Slug memory repo session space path prod dev port Takode rename",
      },
      {
        id: "logs",
        text: "Log Viewer Log File structured server runtime logs filtering Takode CLI",
      },
      {
        id: "changelog",
        text: "Changelog release notes local repository markdown changes",
      },
      {
        id: "restart",
        text: "Restart Server process reconnect sessions interrupt restart blockers pending permission checkout branch behind update code fast-forward",
      },
    ],
  },
];

function sectionSearchText(section: SettingsSectionMeta): string {
  return [section.title, section.description, ...(section.aliases ?? [])].filter(Boolean).join(" ");
}

function itemSearchText(item: SettingItemMeta): string {
  return [item.text, ...(item.aliases ?? [])].filter(Boolean).join(" ");
}

function itemKeys(items: SettingItemMeta[]): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    keys.add(item.id);
    if (item.subsection) keys.add(item.subsection);
  }
  return keys;
}

export function computeSettingsSearchResults(query: string): SettingsSearchResults {
  const trimmed = query.trim();
  const visibleSectionIds = new Set<SettingsSectionId>();
  const sectionMatchCounts = new Map<SettingsSectionId, number>();
  const visibleItemIds = new Map<SettingsSectionId, Set<string>>();

  if (!trimmed) {
    for (const section of SETTINGS_SECTIONS) {
      visibleSectionIds.add(section.id);
      sectionMatchCounts.set(section.id, 0);
      visibleItemIds.set(section.id, itemKeys(section.items));
    }
    return {
      query: trimmed,
      hasQuery: false,
      totalMatches: 0,
      visibleSectionIds,
      sectionMatchCounts,
      visibleItemIds,
    };
  }

  let totalMatches = 0;
  for (const section of SETTINGS_SECTIONS) {
    const titleMatches = sessionSearchTextMatches(sectionSearchText(section), trimmed, "fuzzy");
    const itemMatches = section.items.filter((item) =>
      sessionSearchTextMatches(itemSearchText(item), trimmed, "fuzzy"),
    );
    const matchCount = itemMatches.length + (titleMatches ? 1 : 0);
    if (matchCount > 0) {
      visibleSectionIds.add(section.id);
      sectionMatchCounts.set(section.id, matchCount);
      visibleItemIds.set(section.id, itemKeys(itemMatches));
      totalMatches += matchCount;
    }
  }

  return {
    query: trimmed,
    hasQuery: true,
    totalMatches,
    visibleSectionIds,
    sectionMatchCounts,
    visibleItemIds,
  };
}

/** How far past a group's jump position (its scroll margin, which clears the sticky search bar) it still counts as active. */
const ACTIVE_SECTION_SLACK_PX = 40;

export function useActiveSettingsSection(
  visibleSectionIds: SettingsSectionId[],
  scrollRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): [SettingsSectionId, Dispatch<SetStateAction<SettingsSectionId>>] {
  const fallbackSection = visibleSectionIds[0] ?? SETTINGS_SECTIONS[0].id;
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(fallbackSection);

  useEffect(() => {
    if (!visibleSectionIds.includes(activeSectionId)) {
      setActiveSectionId(fallbackSection);
    }
  }, [activeSectionId, fallbackSection, visibleSectionIds]);

  // The active group is the last one whose top has scrolled up to about where a
  // jump puts it, just below the sticky search bar. It is derived from every
  // group's position on each scroll frame, so a group scrolling out of view
  // cannot re-select itself.
  useEffect(() => {
    if (!enabled) return;
    const root = scrollRef.current;
    if (!root) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rootTop = root.getBoundingClientRect().top;
      let current: SettingsSectionId | null = null;
      for (const id of visibleSectionIds) {
        const node = document.getElementById(settingsSectionDomId(id));
        if (!node) continue;
        const markerY = rootTop + (parseFloat(getComputedStyle(node).scrollMarginTop) || 0) + ACTIVE_SECTION_SLACK_PX;
        if (current !== null && node.getBoundingClientRect().top > markerY) break;
        current = id;
      }
      if (current) setActiveSectionId(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [enabled, scrollRef, visibleSectionIds]);

  return [activeSectionId, setActiveSectionId];
}

export function settingsSectionDomId(id: SettingsSectionId | string): string {
  return `settings-section-${id}`;
}

export function useSettingsSearchNavigation(scrollRef: RefObject<HTMLElement | null>, isActive: boolean) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => computeSettingsSearchResults(query), [query]);
  const visibleSectionIds = useMemo(
    () => SETTINGS_SECTIONS.filter((section) => results.visibleSectionIds.has(section.id)).map((section) => section.id),
    [results.visibleSectionIds],
  );
  const [activeSectionId, setActiveSectionId] = useActiveSettingsSection(visibleSectionIds, scrollRef, isActive);

  /** Props for a group's CollapsibleSection: identity from SETTINGS_SECTIONS plus search state. */
  function sectionProps(id: SettingsSectionId) {
    const meta = SETTINGS_SECTIONS.find((section) => section.id === id)!;
    return {
      id,
      title: meta.title,
      description: meta.description,
      hidden: !results.visibleSectionIds.has(id),
      searchQuery: results.query,
      matchCount: results.sectionMatchCounts.get(id) ?? 0,
    };
  }

  /** Hide a row or subsection (by item id or subsection key) when search matches other items in its group. */
  function rowHidden(sectionId: SettingsSectionId, itemId: string) {
    if (!results.hasQuery) return false;
    const visibleItems = results.visibleItemIds.get(sectionId);
    if (!visibleItems || visibleItems.size === 0) return false;
    return !visibleItems.has(itemId);
  }

  function jumpToSection(id: SettingsSectionId) {
    setActiveSectionId(id);
    document.getElementById(settingsSectionDomId(id))?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return {
    query,
    setQuery,
    results,
    activeSectionId,
    sectionProps,
    rowHidden,
    jumpToSection,
  };
}

export function SettingsSearchControls({
  query,
  setQuery,
  results,
  activeSectionId,
  onJump,
}: {
  query: string;
  setQuery: (query: string) => void;
  results: SettingsSearchResults;
  activeSectionId: SettingsSectionId;
  onJump: (id: SettingsSectionId) => void;
}) {
  const visibleSections = useMemo(
    () => SETTINGS_SECTIONS.filter((section) => results.visibleSectionIds.has(section.id)),
    [results.visibleSectionIds],
  );

  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 bg-cc-bg/95 backdrop-blur border-y border-cc-border/60">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          aria-label="Search settings"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings..."
          className="min-w-0 flex-1 px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60"
        />
        <select
          aria-label="Jump to settings section"
          value={activeSectionId}
          onChange={(event) => onJump(event.target.value as SettingsSectionId)}
          className="lg:hidden px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
        >
          {visibleSections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.title}
              {results.hasQuery ? ` (${results.sectionMatchCounts.get(section.id) ?? 0})` : ""}
            </option>
          ))}
        </select>
      </div>
      {results.hasQuery && results.totalMatches === 0 && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-cc-card border border-cc-border text-sm text-cc-muted">
          No settings match "{results.query}".
        </div>
      )}
    </div>
  );
}

export function SettingsSectionNav({
  results,
  activeSectionId,
  onJump,
}: {
  results: SettingsSearchResults;
  activeSectionId: SettingsSectionId;
  onJump: (id: SettingsSectionId) => void;
}) {
  const visibleSections = SETTINGS_SECTIONS.filter((section) => results.visibleSectionIds.has(section.id));

  return (
    <nav className="hidden lg:block sticky top-24 self-start max-h-[calc(100dvh-7rem)] overflow-y-auto pr-2">
      <div className="space-y-1 border-l border-cc-border pl-2">
        {visibleSections.map((section) => {
          const active = section.id === activeSectionId;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onJump(section.id)}
              className={`w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors cursor-pointer ${
                active ? "bg-cc-primary/12 text-cc-primary" : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
              }`}
            >
              <span className="truncate">{section.title}</span>
              {results.hasQuery && (
                <span className="shrink-0 rounded-full bg-cc-hover px-1.5 py-0.5 text-[10px] text-cc-muted">
                  {results.sectionMatchCounts.get(section.id) ?? 0}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
