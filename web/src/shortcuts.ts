import type { Route } from "./utils/routing.js";

export type ShortcutActionId =
  | "search_session"
  | "toggle_sidebar"
  | "open_terminal"
  | "previous_session"
  | "next_session"
  | "new_session"
  | "voice_start"
  | "voice_stop";

export type ShortcutPresetId = "standard" | "vscode-light" | "vim-light";

export type ShortcutBinding = string;

export interface ShortcutSettings {
  enabled: boolean;
  preset: ShortcutPresetId;
  overrides: Partial<Record<ShortcutActionId, ShortcutBinding | null>>;
}

export interface ShortcutPresetOption {
  id: ShortcutPresetId;
  label: string;
  description: string;
}

export interface ShortcutActionDefinition {
  id: ShortcutActionId;
  label: string;
  description: string;
}

export interface ShortcutBindingOption {
  value: ShortcutBinding | null;
  label: string;
  source: string;
}

export interface ShortcutSessionSummary {
  sessionId: string;
  createdAt: number;
  archived?: boolean;
  cronJobId?: string | null;
  orderIndex?: number | null;
}

export interface ShortcutNewSessionContext {
  cwd?: string;
  treeGroupId?: string;
  newSessionDefaultsKey?: string;
}

export interface ShortcutRuntime {
  route: Route;
  currentSessionId: string | null;
  currentSessionCwd: string | null;
  terminalCwd: string | null;
  activeTab: "chat" | "diff";
  isSearchOpen: boolean;
  sessions: ShortcutSessionSummary[];
  openSearch: () => void;
  closeSearch: () => void;
  lastNewSessionContext?: ShortcutNewSessionContext | null;
  openNewSessionModal: (context?: ShortcutNewSessionContext) => void;
  openTerminal: (cwd: string, sessionId?: string | null) => void;
  captureConversationViewport?: () => void;
  setActiveTab: (tab: "chat" | "diff") => void;
  toggleSidebar: () => void;
  navigateTo: (path: string) => void;
  navigateToSession: (sessionId: string) => void;
  navigateToMostRecentSession: () => boolean;
}

type ShortcutBindingMap = Record<ShortcutActionId, ShortcutBinding | null>;
type ShortcutGestureKind = "combo" | "tap" | "double_tap";

export interface ShortcutActionFilter {
  actionIds?: readonly ShortcutActionId[];
  isActionAvailable?: (actionId: ShortcutActionId) => boolean;
}

const ACTION_ORDER: ShortcutActionId[] = [
  "search_session",
  "toggle_sidebar",
  "open_terminal",
  "previous_session",
  "next_session",
  "new_session",
  "voice_start",
  "voice_stop",
];

const APP_GLOBAL_SHORTCUT_ACTIONS = new Set<ShortcutActionId>(["open_terminal", "previous_session", "next_session"]);
const TAP_BINDING_PREFIX = "Tap:";
const DOUBLE_TAP_BINDING_PREFIX = "DoubleTap:";
export const SHORTCUT_DOUBLE_TAP_WINDOW_MS = 400;

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  enabled: false,
  preset: "standard",
  overrides: {},
};

export const SHORTCUT_ACTIONS: ShortcutActionDefinition[] = [
  {
    id: "search_session",
    label: "Universal Search",
    description: "Open mode-scoped search for quests, sessions, and current-session messages.",
  },
  {
    id: "toggle_sidebar",
    label: "Toggle Sidebar",
    description: "Show or hide the sidebar.",
  },
  {
    id: "open_terminal",
    label: "Open Terminal",
    description: "Open the terminal page for the active session directory.",
  },
  {
    id: "previous_session",
    label: "Previous Session",
    description: "Move to the previous active chat session.",
  },
  {
    id: "next_session",
    label: "Next Session",
    description: "Move to the next active chat session.",
  },
  {
    id: "new_session",
    label: "New Session",
    description: "Open the new session modal.",
  },
  {
    id: "voice_start",
    label: "Start Voice Input",
    description: "Start recording voice input in the composer.",
  },
  {
    id: "voice_stop",
    label: "Stop Voice Recording",
    description: "Finish the active voice recording and transcribe it.",
  },
];

export const SHORTCUT_PRESET_OPTIONS: ShortcutPresetOption[] = [
  {
    id: "standard",
    label: "Standard",
    description: "Lightweight app defaults with familiar browser-style find and simple session navigation.",
  },
  {
    id: "vscode-light",
    label: "VS Code Light",
    description: "Editor-inspired bindings, including Ctrl+` for the terminal and Ctrl+PageUp/PageDown tabs.",
  },
  {
    id: "vim-light",
    label: "Vim Light",
    description: "Home-row-friendly navigation using Alt-based motions without introducing modal editing.",
  },
];

const PRESET_BINDINGS: Record<ShortcutPresetId, ShortcutBindingMap> = {
  standard: {
    search_session: "Mod+F",
    toggle_sidebar: "Mod+B",
    open_terminal: "Mod+Shift+T",
    previous_session: "Mod+Shift+[",
    next_session: "Mod+Shift+]",
    new_session: "Mod+N",
    voice_start: "DoubleTap:Shift",
    voice_stop: "Tap:Shift",
  },
  "vscode-light": {
    search_session: "Mod+F",
    toggle_sidebar: "Mod+B",
    open_terminal: "Ctrl+`",
    previous_session: "Ctrl+PageUp",
    next_session: "Ctrl+PageDown",
    new_session: "Mod+N",
    voice_start: "DoubleTap:Shift",
    voice_stop: "Tap:Shift",
  },
  "vim-light": {
    search_session: "Alt+/",
    toggle_sidebar: "Alt+B",
    open_terminal: "Alt+T",
    previous_session: "Alt+H",
    next_session: "Alt+L",
    new_session: "Alt+N",
    voice_start: "DoubleTap:Shift",
    voice_stop: "Tap:Shift",
  },
};

function normalizeKeyToken(key: string): string {
  return key.toUpperCase();
}

function normalizeShortcutKey(key: string): string {
  const normalized = normalizeKeyToken(key);
  if (normalized === "CTRL") return "CONTROL";
  if (normalized === "CMD") return "META";
  return normalized;
}

function tokenizeBinding(binding: ShortcutBinding): string[] {
  return binding
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeKeyToken);
}

function parseBinding(binding: ShortcutBinding): {
  kind: ShortcutGestureKind;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  mod: boolean;
  key: string | null;
} {
  const tapKey = parseTapBindingKey(binding);
  if (tapKey) {
    return {
      kind: binding.startsWith(DOUBLE_TAP_BINDING_PREFIX) ? "double_tap" : "tap",
      alt: false,
      ctrl: false,
      meta: false,
      shift: false,
      mod: false,
      key: tapKey,
    };
  }

  const tokens = tokenizeBinding(binding);
  let key: string | null = null;
  const parsed = {
    kind: "combo" as ShortcutGestureKind,
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
    mod: false,
    key: null as string | null,
  };

  for (const token of tokens) {
    switch (token) {
      case "ALT":
        parsed.alt = true;
        break;
      case "CTRL":
        parsed.ctrl = true;
        break;
      case "CMD":
      case "META":
        parsed.meta = true;
        break;
      case "SHIFT":
        parsed.shift = true;
        break;
      case "MOD":
        parsed.mod = true;
        break;
      default:
        key = token;
        break;
    }
  }

  parsed.key = key;
  return parsed;
}

function parseTapBindingKey(binding: ShortcutBinding): string | null {
  if (binding.startsWith(DOUBLE_TAP_BINDING_PREFIX)) {
    return normalizeShortcutKey(binding.slice(DOUBLE_TAP_BINDING_PREFIX.length));
  }
  if (binding.startsWith(TAP_BINDING_PREFIX)) {
    return normalizeShortcutKey(binding.slice(TAP_BINDING_PREFIX.length));
  }
  return null;
}

function keyFromKeyboardEvent(event: Pick<KeyboardEvent, "key">): string {
  const key = event.key;
  if (key === " ") return "SPACE";
  return key.toUpperCase();
}

export function isModifierOnlyKey(key: string): boolean {
  return ["SHIFT", "CONTROL", "CTRL", "ALT", "META", "CMD"].includes(key.toUpperCase());
}

function formatShortcutKey(key: string): string {
  switch (normalizeShortcutKey(key)) {
    case "CONTROL":
      return "Ctrl";
    case "META":
      return "Meta";
    case "SHIFT":
      return "Shift";
    case "ALT":
      return "Alt";
    case "SPACE":
      return "Space";
    default:
      break;
  }
  return key.length === 1 ? key : key.charAt(0) + key.slice(1).toLowerCase();
}

function tapBindingForKey(key: string, tapCount: 1 | 2): ShortcutBinding {
  return `${tapCount === 2 ? DOUBLE_TAP_BINDING_PREFIX : TAP_BINDING_PREFIX}${formatShortcutKey(key)}`;
}

export function recordShortcutBindingFromEvent(
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): ShortcutBinding | null {
  const key = keyFromKeyboardEvent(event);
  if (isModifierOnlyKey(key)) return tapBindingForKey(key, 1);

  const tokens: string[] = [];
  if (event.metaKey) tokens.push("Cmd");
  if (event.ctrlKey) tokens.push("Ctrl");
  if (event.altKey) tokens.push("Alt");
  if (event.shiftKey) tokens.push("Shift");
  tokens.push(formatShortcutKey(key));
  return tokens.join("+");
}

export interface ShortcutGestureRecorder {
  keyDown: (event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat">) => void;
  keyUp: (event: Pick<KeyboardEvent, "key">) => void;
  cancel: () => void;
}

export function createShortcutGestureRecorder(
  onBinding: (binding: ShortcutBinding) => void,
  {
    doubleTapWindowMs = SHORTCUT_DOUBLE_TAP_WINDOW_MS,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }: {
    doubleTapWindowMs?: number;
    now?: () => number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
  } = {},
): ShortcutGestureRecorder {
  let activeTapKey: string | null = null;
  let pendingTapKey: string | null = null;
  let pendingTapStartedAt = 0;
  let pendingTapTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPendingTap() {
    if (pendingTapTimer) {
      clearTimer(pendingTapTimer);
      pendingTapTimer = null;
    }
    pendingTapKey = null;
    pendingTapStartedAt = 0;
  }

  function emit(binding: ShortcutBinding) {
    clearPendingTap();
    activeTapKey = null;
    onBinding(binding);
  }

  function scheduleSingleTap(key: string) {
    clearPendingTap();
    pendingTapKey = key;
    pendingTapStartedAt = now();
    pendingTapTimer = setTimer(() => {
      emit(tapBindingForKey(key, 1));
    }, doubleTapWindowMs);
  }

  return {
    keyDown(event) {
      const key = keyFromKeyboardEvent(event);
      if (event.repeat) return;
      if (!isModifierOnlyKey(key)) {
        emit(recordShortcutBindingFromEvent(event) ?? tapBindingForKey(key, 1));
        return;
      }
      if (activeTapKey && activeTapKey !== key) {
        activeTapKey = null;
        return;
      }
      activeTapKey = key;
    },
    keyUp(event) {
      const key = keyFromKeyboardEvent(event);
      if (activeTapKey !== key) return;
      activeTapKey = null;
      if (pendingTapKey === key && now() - pendingTapStartedAt < doubleTapWindowMs) {
        emit(tapBindingForKey(key, 2));
        return;
      }
      scheduleSingleTap(key);
    },
    cancel() {
      clearPendingTap();
      activeTapKey = null;
    },
  };
}

function bindingMatchesEventKey(bindingKey: string, event: Pick<KeyboardEvent, "key"> & { code?: string }): boolean {
  const eventKey = keyFromKeyboardEvent(event);
  if (bindingKey === eventKey) return true;

  // Shifted bracket bindings emit "{" / "}" on event.key, but the
  // shortcut should still match the underlying [ / ] physical keys.
  if (bindingKey === "[" && event.code === "BracketLeft") return true;
  if (bindingKey === "]" && event.code === "BracketRight") return true;

  return false;
}

function platformIsMac(platform?: string): boolean {
  if (!platform) return false;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function getShortcutPresetBindings(preset: ShortcutPresetId): ShortcutBindingMap {
  return PRESET_BINDINGS[preset];
}

export function getShortcutActionDefinition(actionId: ShortcutActionId): ShortcutActionDefinition {
  return SHORTCUT_ACTIONS.find((action) => action.id === actionId) ?? SHORTCUT_ACTIONS[0]!;
}

export function getEffectiveShortcutBinding(
  settings: ShortcutSettings | null | undefined,
  actionId: ShortcutActionId,
): ShortcutBinding | null {
  const resolved = settings ?? DEFAULT_SHORTCUT_SETTINGS;
  if (Object.prototype.hasOwnProperty.call(resolved.overrides, actionId)) {
    return resolved.overrides[actionId] ?? null;
  }
  return getShortcutPresetBindings(resolved.preset)[actionId] ?? null;
}

export function formatShortcut(binding: ShortcutBinding, platform?: string): string {
  const parsed = parseBinding(binding);
  if (parsed.kind === "double_tap" && parsed.key) return `Double ${formatShortcutKey(parsed.key)}`;
  if (parsed.kind === "tap" && parsed.key && isModifierOnlyKey(parsed.key)) return formatShortcutKey(parsed.key);
  if (parsed.kind === "tap" && parsed.key) return `Tap ${formatShortcutKey(parsed.key)}`;

  const isMac = platformIsMac(platform);
  return tokenizeBinding(binding)
    .map((token) => {
      switch (token) {
        case "MOD":
          return isMac ? "Cmd" : "Ctrl";
        case "CMD":
        case "META":
          return isMac ? "Cmd" : "Meta";
        case "CTRL":
          return "Ctrl";
        case "ALT":
          return isMac ? "Option" : "Alt";
        case "SHIFT":
          return "Shift";
        case "PAGEUP":
          return "PageUp";
        case "PAGEDOWN":
          return "PageDown";
        case "SPACE":
          return "Space";
        default:
          if (token.length === 1) return token;
          return token.charAt(0) + token.slice(1).toLowerCase();
      }
    })
    .join("+");
}

export function getShortcutHint(
  settings: ShortcutSettings | null | undefined,
  actionId: ShortcutActionId,
  platform?: string,
): string | null {
  const resolved = settings ?? DEFAULT_SHORTCUT_SETTINGS;
  if (!resolved.enabled) return null;
  const binding = getEffectiveShortcutBinding(resolved, actionId);
  return binding ? formatShortcut(binding, platform) : null;
}

export function getShortcutTitle(
  baseTitle: string,
  settings: ShortcutSettings | null | undefined,
  actionId: ShortcutActionId,
  platform?: string,
): string {
  const hint = getShortcutHint(settings, actionId, platform);
  return hint ? `${baseTitle} (${hint})` : baseTitle;
}

export function getShortcutBindingOptions(
  actionId: ShortcutActionId,
  platform?: string,
  preset?: ShortcutPresetId,
): ShortcutBindingOption[] {
  const options: ShortcutBindingOption[] = [];
  const seen = new Set<string>();

  if (preset) {
    const presetBinding = getShortcutPresetBindings(preset)[actionId] ?? null;
    const presetLabel = SHORTCUT_PRESET_OPTIONS.find((option) => option.id === preset)?.label ?? "Preset";
    options.push({
      value: presetBinding,
      label: presetBinding ? `${formatShortcut(presetBinding, platform)} (Preset default)` : "Off (Preset default)",
      source: presetLabel,
    });
    seen.add(presetBinding ?? "__none__");
  }

  for (const option of SHORTCUT_PRESET_OPTIONS) {
    const binding = getShortcutPresetBindings(option.id)[actionId] ?? null;
    const dedupeKey = binding ?? "__none__";
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    options.push({
      value: binding,
      label: binding ? formatShortcut(binding, platform) : "Off",
      source: option.label,
    });
  }

  if (!seen.has("__none__")) {
    options.push({ value: null, label: "Off", source: "Disabled" });
  }

  return options;
}

export function shortcutsEqual(
  left: ShortcutSettings | null | undefined,
  right: ShortcutSettings | null | undefined,
): boolean {
  const a = left ?? DEFAULT_SHORTCUT_SETTINGS;
  const b = right ?? DEFAULT_SHORTCUT_SETTINGS;
  if (a.enabled !== b.enabled || a.preset !== b.preset) return false;
  for (const actionId of ACTION_ORDER) {
    if ((a.overrides[actionId] ?? undefined) !== (b.overrides[actionId] ?? undefined)) return false;
  }
  return true;
}

export function isShortcutEventTargetEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function shouldBlurVimEscape(
  settings: ShortcutSettings | null | undefined,
  event: Pick<KeyboardEvent, "key">,
  target: EventTarget | null,
): boolean {
  const resolved = settings ?? DEFAULT_SHORTCUT_SETTINGS;
  return (
    resolved.enabled &&
    resolved.preset === "vim-light" &&
    event.key === "Escape" &&
    isShortcutEventTargetEditable(target)
  );
}

export function isAppGlobalShortcutAction(actionId: ShortcutActionId): boolean {
  return APP_GLOBAL_SHORTCUT_ACTIONS.has(actionId);
}

function actionFilterAllows(actionId: ShortcutActionId, filter?: ShortcutActionFilter): boolean {
  if (filter?.actionIds && !filter.actionIds.includes(actionId)) return false;
  return filter?.isActionAvailable?.(actionId) ?? true;
}

export function matchesShortcutEvent(
  binding: ShortcutBinding,
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> & { code?: string },
): boolean {
  const parsed = parseBinding(binding);
  if (parsed.kind !== "combo") return false;
  if (!parsed.key || !bindingMatchesEventKey(parsed.key, event)) return false;

  const expectsCtrl =
    parsed.ctrl || (parsed.mod && !platformIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined));
  const expectsMeta =
    parsed.meta || (parsed.mod && platformIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined));

  return (
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.ctrlKey === expectsCtrl &&
    event.metaKey === expectsMeta
  );
}

export function getMatchingShortcutAction(
  settings: ShortcutSettings | null | undefined,
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> & { code?: string },
  filter?: ShortcutActionFilter,
): ShortcutActionId | null {
  const resolved = settings ?? DEFAULT_SHORTCUT_SETTINGS;
  if (!resolved.enabled) return null;
  for (const actionId of ACTION_ORDER) {
    if (!actionFilterAllows(actionId, filter)) continue;
    const binding = getEffectiveShortcutBinding(resolved, actionId);
    if (binding && matchesShortcutEvent(binding, event)) return actionId;
  }
  return null;
}

export function getMatchingShortcutTapAction(
  settings: ShortcutSettings | null | undefined,
  key: string,
  tapCount: 1 | 2,
  filter?: ShortcutActionFilter,
): ShortcutActionId | null {
  const resolved = settings ?? DEFAULT_SHORTCUT_SETTINGS;
  if (!resolved.enabled) return null;
  const normalizedKey = normalizeShortcutKey(key);
  const expectedKind: ShortcutGestureKind = tapCount === 2 ? "double_tap" : "tap";
  for (const actionId of ACTION_ORDER) {
    if (!actionFilterAllows(actionId, filter)) continue;
    const binding = getEffectiveShortcutBinding(resolved, actionId);
    if (!binding) continue;
    const parsed = parseBinding(binding);
    if (parsed.kind === expectedKind && parsed.key === normalizedKey) return actionId;
  }
  return null;
}

export function getShortcutSessions(sessions: ShortcutSessionSummary[]): ShortcutSessionSummary[] {
  const base = sessions.filter((session) => !session.archived && !session.cronJobId);
  const hasSidebarOrder = base.some((session) => typeof session.orderIndex === "number");
  return [...base]
    .filter((session) => !hasSidebarOrder || typeof session.orderIndex === "number")
    .sort((left, right) => {
      const leftOrder = left.orderIndex;
      const rightOrder = right.orderIndex;
      if (typeof leftOrder === "number" && typeof rightOrder === "number") {
        return leftOrder - rightOrder;
      }
      if (typeof leftOrder === "number") return -1;
      if (typeof rightOrder === "number") return 1;
      return right.createdAt - left.createdAt;
    });
}

function getAnchorSessionIndex(sessions: ShortcutSessionSummary[], currentSessionId: string | null): number {
  if (!currentSessionId) return 0;
  const index = sessions.findIndex((session) => session.sessionId === currentSessionId);
  return index >= 0 ? index : 0;
}

export function getAdjacentShortcutSessionId(
  sessions: ShortcutSessionSummary[],
  currentSessionId: string | null,
  direction: "previous_session" | "next_session",
): string | null {
  const ordered = getShortcutSessions(sessions);
  if (ordered.length === 0) return null;
  if (ordered.length === 1) return ordered[0]!.sessionId;
  const currentIndex = getAnchorSessionIndex(ordered, currentSessionId);
  const delta = direction === "previous_session" ? -1 : 1;
  const nextIndex = (currentIndex + delta + ordered.length) % ordered.length;
  return ordered[nextIndex]!.sessionId;
}

export function resolveShortcutNewSessionContext(
  currentSessionCwd: string | null,
  lastContext?: ShortcutNewSessionContext | null,
): ShortcutNewSessionContext | undefined {
  const cwd = currentSessionCwd ?? lastContext?.cwd ?? "";
  const treeGroupId = lastContext?.treeGroupId;
  const newSessionDefaultsKey = lastContext?.newSessionDefaultsKey;
  if (!cwd && !treeGroupId && !newSessionDefaultsKey) return undefined;
  return {
    ...(cwd ? { cwd } : {}),
    ...(treeGroupId ? { treeGroupId } : {}),
    ...(newSessionDefaultsKey ? { newSessionDefaultsKey } : {}),
  };
}

export function performShortcutAction(actionId: ShortcutActionId, runtime: ShortcutRuntime): boolean {
  switch (actionId) {
    case "search_session": {
      if (!runtime.isSearchOpen) runtime.openSearch();
      return true;
    }
    case "toggle_sidebar":
      runtime.toggleSidebar();
      return true;
    case "open_terminal": {
      if (runtime.route.page === "terminal") {
        if (runtime.currentSessionId) {
          runtime.navigateToSession(runtime.currentSessionId);
          runtime.setActiveTab("chat");
          return true;
        }
        return runtime.navigateToMostRecentSession();
      }
      runtime.captureConversationViewport?.();
      const cwd = runtime.currentSessionCwd ?? runtime.terminalCwd;
      if (cwd) runtime.openTerminal(cwd, runtime.currentSessionId);
      runtime.navigateTo("/terminal");
      return true;
    }
    case "previous_session":
    case "next_session": {
      const sessionId = getAdjacentShortcutSessionId(runtime.sessions, runtime.currentSessionId, actionId);
      if (!sessionId) return false;
      runtime.navigateToSession(sessionId);
      runtime.setActiveTab("chat");
      return true;
    }
    case "new_session":
      runtime.openNewSessionModal(
        resolveShortcutNewSessionContext(runtime.currentSessionCwd, runtime.lastNewSessionContext),
      );
      return true;
    default:
      return false;
  }
}
