import { useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { sessionSearchTextMatches } from "../store-session-search.js";

type SettingItemMeta = {
  id: string;
  text: string;
  aliases?: string[];
  /** Subsection that shows this item; a subsection stays visible while any of its items match. */
  subsection?: string;
};

export type SettingsSectionId = "appearance" | "input" | "notifications" | "sessions" | "system" | "server";

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

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme, size, and how chat content is displayed.",
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
    ],
  },
  {
    id: "input",
    title: "Input & Voice",
    description: "How messages are sent, keyboard shortcuts, and voice dictation.",
    aliases: ["keyboard", "keys", "hotkeys", "typing", "composer", "voice", "dictation"],
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
        text: "Record shortcut override actions reset bindings",
        subsection: "shortcuts",
      },
      {
        id: "voice-credentials",
        text: "Voice Transcription API Key Base URL OpenAI Whisper stt speech transcribe audio",
        subsection: "voice",
      },
      {
        id: "voice-models",
        text: "STT Model Enhancement Model expected languages hints",
        subsection: "voice",
      },
      {
        id: "voice-enhancement",
        text: "Enhancement Style prose bullet points",
        subsection: "voice",
      },
      {
        id: "voice-vocabulary",
        text: "Custom Vocabulary terms model mishears vocabulary hints",
        subsection: "voice",
      },
      {
        id: "voice-tester",
        text: "Enhancement Tester debug panel",
        subsection: "voice",
      },
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
    description: "Defaults and automation for new and running sessions.",
    aliases: ["defaults", "leader", "worker", "automation"],
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
        id: "leader-profiles",
        text: "Leader Profiles built-in portrait pools Tako Shmi avatars",
        aliases: ["portrait", "avatar", "profile"],
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
        id: "auto-approval-enabled",
        text: "Auto-Approval LLM enabled permission requests",
        subsection: "auto-approval",
      },
      {
        id: "auto-approval-model",
        text: "Auto-approval Model Haiku Sonnet session model",
        subsection: "auto-approval",
      },
      {
        id: "auto-approval-limits",
        text: "Auto-approval Max concurrency timeout seconds",
        subsection: "auto-approval",
      },
      {
        id: "auto-approval-rules",
        text: "Auto-approval Project Rules criteria project paths add rule folder",
        subsection: "auto-approval",
      },
      {
        id: "auto-approval-debug",
        text: "Auto-approval Debug panel logs",
        subsection: "auto-approval",
      },
      {
        id: "environments",
        text: "Manage Environments environment variables profiles",
      },
    ],
  },
  {
    id: "system",
    title: "System",
    description: "Backend CLIs, the file-link editor, resource use, and other machines that run sessions.",
    aliases: ["backend", "binary", "path", "performance", "resources", "remote", "machine"],
    items: [
      {
        id: "claude",
        text: "Claude Code binary path command auto-detect CLI",
        subsection: "cli",
      },
      {
        id: "codex",
        text: "Codex binary path command auto-detect CLI",
        subsection: "cli",
      },
      {
        id: "editor",
        text: "File Link Editor VSCode local remote Cursor none editor",
        aliases: ["vscode"],
      },
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
      {
        id: "login",
        text: "Login password browser log in log out sign out devices security access remote phone",
        aliases: ["password", "security"],
      },
      {
        id: "hosts",
        text: "Hosts other machines remote devbox takode node token coordinator add host remove online offline",
      },
    ],
  },
  {
    id: "server",
    title: "Server & Data",
    description: "Server identity, logs, session backups, and restart.",
    aliases: ["diagnostics", "server", "data", "backup"],
    items: [
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
        id: "session-data",
        text: "Session Data Export All Sessions Import Sessions portable archive paths",
      },
      {
        id: "restart",
        text: "Restart Server process reconnect sessions interrupt restart blockers pending permission",
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

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const root = scrollRef.current;
    if (!root) return;

    const visibleSet = new Set(visibleSectionIds);
    const nodes = SETTINGS_SECTIONS.map((section) => document.getElementById(settingsSectionDomId(section.id))).filter(
      (node): node is HTMLElement =>
        node !== null && visibleSet.has(node.dataset.settingsSectionId as SettingsSectionId),
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
        const next = visible[0]?.target.getAttribute("data-settings-section-id") as SettingsSectionId | null;
        if (next) setActiveSectionId(next);
      },
      { root, rootMargin: "-12% 0px -72% 0px", threshold: [0, 0.1, 0.25] },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
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

  function sectionSearch(id: SettingsSectionId) {
    return {
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
    sectionSearch,
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
