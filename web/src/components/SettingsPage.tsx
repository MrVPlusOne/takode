import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  checkReadinessStatus,
  isInterruptRestartBlockersResponse,
  type AppSettings,
  type TranscriptionConfig,
  type EditorKind,
  type InterruptRestartBlockersResponse,
} from "../api.js";
import { useStore, COLOR_THEMES } from "../store.js";
import {
  beginBuildIdentityObservation,
  getBuildCompatibilitySnapshot,
  observeServerBuildIdentity,
} from "../build-compatibility.js";
import { createInitiatingTabRestartIntent, type InitiatingTabRestartIntent } from "../server-restart-auto-reload.js";
import { createShortcutGestureRecorder, type ShortcutActionId } from "../shortcuts.js";
import { CollapsibleSection, isCollapsibleSectionCollapsed } from "./CollapsibleSection.js";
import { SettingsLeaderProfilesSection } from "./SettingsLeaderProfilesSection.js";
import { SettingsServerDiagnosticsSection } from "./SettingsServerDiagnosticsSection.js";
import { SettingsSessionDefaultsSection } from "./SettingsSessionDefaultsSection.js";
import { SettingsWebPushSection } from "./SettingsWebPushSection.js";
import { SettingsHostsSection } from "./SettingsHostsSection.js";
import { SettingsLoginSection } from "./SettingsLoginSection.js";
import { SendKeySchemeSetting, SettingsShortcutSection } from "./SettingsShortcutSection.js";
import { SettingsPhoneAlertRules, SettingsPushoverSection } from "./SettingsPhoneAlertsSection.js";
import { SettingsSessionDataSection } from "./SettingsSessionDataSection.js";
import { SettingsSessionNamerSection } from "./SettingsSessionNamerSection.js";
import {
  NumberStepper,
  SegmentedControl,
  SettingsRow,
  SettingsSubsection,
  SettingsToggle,
} from "./settings-controls.js";
import {
  BUILT_IN_STT_MODELS,
  CUSTOM_STT_MODEL_VALUE,
  DEFAULT_STT_MODEL,
  SettingsVoiceTranscriptionSection,
} from "./SettingsVoiceTranscriptionSection.js";
import {
  DEFAULT_CHAT_MESSAGE_LINE_HEIGHT,
  MAX_CHAT_MESSAGE_LINE_HEIGHT,
  MIN_CHAT_MESSAGE_LINE_HEIGHT,
  normalizeChatMessageLineHeight,
} from "../../shared/chat-display-settings.js";
import {
  DEFAULT_SESSION_DEFAULTS,
  SESSION_DEFAULTS_UPDATED_EVENT,
  normalizeSessionDefaults,
  type SessionDefaultsSettings,
} from "../../shared/session-defaults.js";
import type { LeaderProfilePoolSettings } from "../../shared/leader-profile-portraits.js";
import { SettingsPageHeader } from "./SettingsPageHeader.js";
import { SettingsSearchControls, SettingsSectionNav, useSettingsSearchNavigation } from "./settings-search.js";
import { EDIT_BLOCKS_EXPANDED_KEY } from "./ToolBlock.js";
import {
  normalizeCodexLeaderCompactionMode,
  type CodexLeaderCompactionMode,
} from "../../shared/codex-leader-compaction-mode.js";

import { navigateToSession, navigateToMostRecentSession } from "../utils/routing.js";

const SCROLL_STORAGE_KEY = "cc-settings-scroll";

interface SettingsPageProps {
  embedded?: boolean;
  isActive?: boolean;
  onReloadAfterRestart?: () => void;
}

function reloadCurrentPage(): void {
  window.location.reload();
}

export function SettingsPage({
  embedded = false,
  isActive = true,
  onReloadAfterRestart = reloadCurrentPage,
}: SettingsPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Last settings snapshot from the server; self-contained subsections sync their local form state from it.
  const [loadedSettings, setLoadedSettings] = useState<AppSettings | null>(null);
  const colorTheme = useStore((s) => s.colorTheme);
  const setColorTheme = useStore((s) => s.setColorTheme);
  const zoomLevel = useStore((s) => s.zoomLevel);
  const setZoomLevel = useStore((s) => s.setZoomLevel);
  const notificationSound = useStore((s) => s.notificationSound);
  const toggleNotificationSound = useStore((s) => s.toggleNotificationSound);
  const notificationDesktop = useStore((s) => s.notificationDesktop);
  const setNotificationDesktop = useStore((s) => s.setNotificationDesktop);
  const showUsageBars = useStore((s) => s.showUsageBars);
  const toggleShowUsageBars = useStore((s) => s.toggleShowUsageBars);
  const compactToolActivity = useStore((s) => s.compactToolActivity);
  const toggleCompactToolActivity = useStore((s) => s.toggleCompactToolActivity);
  const setChatMessageLineHeight = useStore((s) => s.setChatMessageLineHeight);
  const shortcutSettings = useStore((s) => s.shortcutSettings);
  const setShortcutsEnabled = useStore((s) => s.setShortcutsEnabled);
  const setShortcutPreset = useStore((s) => s.setShortcutPreset);
  const setShortcutOverride = useStore((s) => s.setShortcutOverride);
  const resetShortcutOverrides = useStore((s) => s.resetShortcutOverrides);
  const notificationApiAvailable = typeof Notification !== "undefined";
  const shortcutPlatform = typeof navigator === "undefined" ? undefined : navigator.platform;
  const [recordingShortcutActionId, setRecordingShortcutActionId] = useState<ShortcutActionId | null>(null);
  const [chatMessageLineHeight, setChatMessageLineHeightValue] = useState(DEFAULT_CHAT_MESSAGE_LINE_HEIGHT);
  const [chatMessageLineHeightSaving, setChatMessageLineHeightSaving] = useState(false);
  const [chatMessageLineHeightError, setChatMessageLineHeightError] = useState("");
  const chatMessageLineHeightSaveSeqRef = useRef(0);
  const latestChatMessageLineHeightRef = useRef(DEFAULT_CHAT_MESSAGE_LINE_HEIGHT);
  const persistedChatMessageLineHeightRef = useRef(DEFAULT_CHAT_MESSAGE_LINE_HEIGHT);

  // Edit/Write blocks default-expanded preference (localStorage, global)
  const [editBlocksExpanded, setEditBlocksExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(EDIT_BLOCKS_EXPANDED_KEY);
    if (stored !== null) return stored !== "false";
    return true;
  });
  const toggleEditBlocksExpanded = () => {
    setEditBlocksExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(EDIT_BLOCKS_EXPANDED_KEY, String(next));
      return next;
    });
  };

  // CLI binary state
  const [claudeBin, setClaudeBin] = useState("");
  const [codexBin, setCodexBin] = useState("");
  const [codexLeaderCompactionMode, setCodexLeaderCompactionMode] = useState<CodexLeaderCompactionMode>("recycle");
  const [logFile, setLogFile] = useState("");
  const [binSaving, setBinSaving] = useState(false);
  const [binError, setBinError] = useState("");
  const [leaderProfilePools, setLeaderProfilePools] = useState<LeaderProfilePoolSettings | undefined>(undefined);
  const [claudeTest, setClaudeTest] = useState<{
    ok: boolean;
    resolvedPath?: string;
    version?: string;
    error?: string;
  } | null>(null);
  const [codexTest, setCodexTest] = useState<{
    ok: boolean;
    resolvedPath?: string;
    version?: string;
    error?: string;
  } | null>(null);
  const [claudeTesting, setClaudeTesting] = useState(false);
  const [codexTesting, setCodexTesting] = useState(false);
  const [editorChoice, setEditorChoice] = useState<EditorKind>("none");
  const [sessionDefaults, setSessionDefaults] = useState<SessionDefaultsSettings>(DEFAULT_SESSION_DEFAULTS);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const binDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session lifecycle state
  const [maxKeepAlive, setMaxKeepAlive] = useState(0);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const [heavyRepoModeEnabled, setHeavyRepoModeEnabled] = useState(false);
  const [heavyRepoSaving, setHeavyRepoSaving] = useState(false);
  const [heavyRepoError, setHeavyRepoError] = useState("");

  // Sleep inhibitor state
  const [sleepInhibitorEnabled, setSleepInhibitorEnabled] = useState(false);
  const [sleepInhibitorDuration, setSleepInhibitorDuration] = useState(5);
  const [sleepInhibitorSaving, setSleepInhibitorSaving] = useState(false);
  const [sleepInhibitorError, setSleepInhibitorError] = useState("");
  const [caffeinateStatus, setCaffeinateStatus] = useState<{
    active: boolean;
    engagedAt: number | null;
    expiresAt: number | null;
  }>({ active: false, engagedAt: null, expiresAt: null });
  const [caffeinateTick, setCaffeinateTick] = useState(0);
  const lifecycleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [performanceCollapsed, setPerformanceCollapsed] = useState(() => isCollapsibleSectionCollapsed("performance"));
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  // Server restart state
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");
  const [restartPrepResult, setRestartPrepResult] = useState<InterruptRestartBlockersResponse | null>(null);
  const [restartSupported, setRestartSupported] = useState(true);
  const [serverSlug, setServerSlug] = useState("");
  const [serverSlugSaving, setServerSlugSaving] = useState(false);
  const [serverSlugError, setServerSlugError] = useState("");
  const healthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartAttemptSequenceRef = useRef(0);
  const restartIntentRef = useRef<InitiatingTabRestartIntent | null>(null);

  // Voice transcription state
  const [transcriptionApiKey, setTranscriptionApiKey] = useState("");
  const [transcriptionBaseUrl, setTranscriptionBaseUrl] = useState("");
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [sttModel, setSttModel] = useState(DEFAULT_STT_MODEL);
  const [customSttModel, setCustomSttModel] = useState("");
  const [sttLanguageHints, setSttLanguageHints] = useState<string[]>([]);
  const [transcriptionEnhancement, setTranscriptionEnhancement] = useState(false);
  const [enhancementMode, setEnhancementMode] = useState<"default" | "bullet">("default");
  const [transcriptionVocabulary, setTranscriptionVocabulary] = useState("");
  const [transcriptionSaving, setTranscriptionSaving] = useState(false);
  const [transcriptionSaved, setTranscriptionSaved] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const settingsSearch = useSettingsSearchNavigation(scrollRef, isActive);

  function navigateBackFromSettings() {
    const sessionId = useStore.getState().currentSessionId;
    if (sessionId) {
      navigateToSession(sessionId);
    } else {
      navigateToMostRecentSession();
    }
  }

  useEffect(() => {
    if (!isActive) return;
    api
      .getSettings()
      .then((s) => {
        setLoadedSettings(s);
        setClaudeBin(s.claudeBinary || "");
        setCodexBin(s.codexBinary || "");
        setCodexLeaderCompactionMode(normalizeCodexLeaderCompactionMode(s.codexLeaderCompactionMode));
        setLeaderProfilePools(s.leaderProfilePools);
        setLogFile(s.logFile || "");
        setMaxKeepAlive(s.maxKeepAlive || 0);
        setHeavyRepoModeEnabled(s.heavyRepoModeEnabled ?? false);
        const normalizedChatMessageLineHeight = normalizeChatMessageLineHeight(s.chatMessageLineHeight);
        setChatMessageLineHeightValue(normalizedChatMessageLineHeight);
        setChatMessageLineHeight(normalizedChatMessageLineHeight);
        latestChatMessageLineHeightRef.current = normalizedChatMessageLineHeight;
        persistedChatMessageLineHeightRef.current = normalizedChatMessageLineHeight;
        setSleepInhibitorEnabled(s.sleepInhibitorEnabled ?? false);
        setSleepInhibitorDuration(s.sleepInhibitorDurationMinutes ?? 5);
        setRestartSupported(s.restartSupported);
        setServerSlug(s.serverSlug || "");
        setSessionDefaults(normalizeSessionDefaults(s.sessionDefaults));
        if (s.transcriptionConfig) {
          setTranscriptionApiKey(s.transcriptionConfig.apiKey === "***" ? "***" : s.transcriptionConfig.apiKey || "");
          setTranscriptionBaseUrl(s.transcriptionConfig.baseUrl || "");
          setTranscriptionModel(s.transcriptionConfig.enhancementModel || "");
          const configuredSttModel = s.transcriptionConfig.sttModel || DEFAULT_STT_MODEL;
          if (BUILT_IN_STT_MODELS.includes(configuredSttModel as (typeof BUILT_IN_STT_MODELS)[number])) {
            setSttModel(configuredSttModel);
            setCustomSttModel("");
          } else {
            setSttModel(CUSTOM_STT_MODEL_VALUE);
            setCustomSttModel(configuredSttModel);
          }
          setTranscriptionEnhancement(s.transcriptionConfig.enhancementEnabled ?? false);
          setEnhancementMode(s.transcriptionConfig.enhancementMode ?? "default");
          setTranscriptionVocabulary(s.transcriptionConfig.customVocabulary || "");
          setSttLanguageHints(s.transcriptionConfig.sttLanguageHints || []);
        }
        setEditorChoice(s.editorConfig?.editor ?? "none");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [isActive]);

  useEffect(() => {
    return () => {
      restartAttemptSequenceRef.current += 1;
      restartIntentRef.current?.cancel();
      restartIntentRef.current = null;
      if (healthPollRef.current) clearInterval(healthPollRef.current);
      if (healthTimeoutRef.current) clearTimeout(healthTimeoutRef.current);
      healthPollRef.current = null;
      healthTimeoutRef.current = null;
      useStore.getState().setServerRestarting(false);
    };
  }, []);

  useEffect(() => {
    const handleSessionDefaultsUpdate = (event: Event) => {
      setSessionDefaults(normalizeSessionDefaults((event as CustomEvent<SessionDefaultsSettings>).detail));
    };
    window.addEventListener(SESSION_DEFAULTS_UPDATED_EVENT, handleSessionDefaultsUpdate);
    return () => window.removeEventListener(SESSION_DEFAULTS_UPDATED_EVENT, handleSessionDefaultsUpdate);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      setDocumentVisible(document.visibilityState === "visible");
    };
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Settings pages may not have a selected-session websocket. Poll the
  // server-owned defaults so separate browsers converge even in that state.
  useEffect(() => {
    if (!isActive || !documentVisible) return;
    let cancelled = false;
    const pollSessionDefaults = () => {
      api
        .getSettings()
        .then((settings) => {
          if (!cancelled) setSessionDefaults(normalizeSessionDefaults(settings.sessionDefaults));
        })
        .catch(() => {});
    };
    const id = setInterval(pollSessionDefaults, 2_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [documentVisible, isActive]);

  // Poll caffeinate status every 5s when sleep inhibitor is enabled
  useEffect(() => {
    if (!sleepInhibitorEnabled) {
      setCaffeinateStatus({ active: false, engagedAt: null, expiresAt: null });
      return;
    }
    if (!isActive || performanceCollapsed || !documentVisible) return;
    let cancelled = false;
    const poll = () => {
      api
        .getCaffeinateStatus()
        .then((s) => {
          if (!cancelled) setCaffeinateStatus(s);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [documentVisible, isActive, performanceCollapsed, sleepInhibitorEnabled]);

  // Tick every second to update elapsed/countdown display
  useEffect(() => {
    if (!isActive || performanceCollapsed || !documentVisible) return;
    if (!sleepInhibitorEnabled || !caffeinateStatus.active) return;
    const id = setInterval(() => setCaffeinateTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, [caffeinateStatus.active, documentVisible, isActive, performanceCollapsed, sleepInhibitorEnabled]);

  // Restore scroll position on mount, save on scroll (debounced) and unmount
  useEffect(() => {
    if (!isActive) return;
    const el = scrollRef.current;
    if (!el) return;

    try {
      const saved = localStorage.getItem(SCROLL_STORAGE_KEY);
      if (saved) el.scrollTop = JSON.parse(saved);
    } catch {
      /* ignore corrupt data */
    }

    let timeout: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        localStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(el.scrollTop));
      }, 300);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(timeout);
      localStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(el.scrollTop));
    };
  }, [isActive]);

  // Debounced auto-save for CLI binaries (fires 800ms after last keystroke)
  function debouncedSaveBinaries(newClaude: string, newCodex: string) {
    if (binDebounceRef.current) clearTimeout(binDebounceRef.current);
    binDebounceRef.current = setTimeout(async () => {
      setBinSaving(true);
      setBinError("");
      try {
        const res = await api.updateSettings({
          claudeBinary: newClaude.trim(),
          codexBinary: newCodex.trim(),
        });
        setClaudeBin(res.claudeBinary || "");
        setCodexBin(res.codexBinary || "");
      } catch (err: unknown) {
        setBinError(err instanceof Error ? err.message : String(err));
      } finally {
        setBinSaving(false);
      }
    }, 800);
  }

  async function onTestBinary(which: "claude" | "codex") {
    const binary = which === "claude" ? claudeBin.trim() || "claude" : codexBin.trim() || "codex";
    const setTesting = which === "claude" ? setClaudeTesting : setCodexTesting;
    const setResult = which === "claude" ? setClaudeTest : setCodexTest;
    setTesting(true);
    setResult(null);
    try {
      const res = await api.testBinary(binary);
      setResult(res);
    } catch (err: unknown) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
      setTimeout(() => setResult(null), 5000);
    }
  }

  async function onChangeEditor(nextEditor: EditorKind) {
    setEditorChoice(nextEditor);
    setEditorSaving(true);
    setEditorError("");
    try {
      const res = await api.updateSettings({
        editorConfig: { editor: nextEditor },
      });
      setEditorChoice(res.editorConfig?.editor ?? nextEditor);
    } catch (err: unknown) {
      setEditorError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditorSaving(false);
    }
  }

  // Debounced auto-save for session lifecycle (fires 800ms after last change)
  function debouncedSaveLifecycle(newValue: number) {
    if (lifecycleDebounceRef.current) clearTimeout(lifecycleDebounceRef.current);
    lifecycleDebounceRef.current = setTimeout(async () => {
      setLifecycleSaving(true);
      setLifecycleError("");
      try {
        const res = await api.updateSettings({ maxKeepAlive: newValue });
        setMaxKeepAlive(res.maxKeepAlive || 0);
      } catch (err: unknown) {
        setLifecycleError(err instanceof Error ? err.message : String(err));
      } finally {
        setLifecycleSaving(false);
      }
    }, 800);
  }

  async function saveHeavyRepoMode(enabled: boolean) {
    setHeavyRepoSaving(true);
    setHeavyRepoError("");
    try {
      const res = await api.updateSettings({ heavyRepoModeEnabled: enabled });
      setHeavyRepoModeEnabled(res.heavyRepoModeEnabled ?? false);
    } catch (err: unknown) {
      setHeavyRepoModeEnabled(!enabled);
      setHeavyRepoError(err instanceof Error ? err.message : String(err));
    } finally {
      setHeavyRepoSaving(false);
    }
  }

  async function saveChatMessageLineHeight(nextRaw: number) {
    const next = normalizeChatMessageLineHeight(nextRaw);
    const requestSeq = ++chatMessageLineHeightSaveSeqRef.current;
    latestChatMessageLineHeightRef.current = next;
    setChatMessageLineHeightValue(next);
    setChatMessageLineHeight(next);
    setChatMessageLineHeightSaving(true);
    setChatMessageLineHeightError("");
    try {
      const res = await api.updateSettings({ chatMessageLineHeight: next });
      const saved = normalizeChatMessageLineHeight(res.chatMessageLineHeight);
      if (requestSeq !== chatMessageLineHeightSaveSeqRef.current) {
        if (saved !== latestChatMessageLineHeightRef.current) {
          persistedChatMessageLineHeightRef.current = saved;
          void saveChatMessageLineHeight(latestChatMessageLineHeightRef.current);
        } else {
          persistedChatMessageLineHeightRef.current = saved;
        }
        return;
      }
      persistedChatMessageLineHeightRef.current = saved;
      latestChatMessageLineHeightRef.current = saved;
      setChatMessageLineHeightValue(saved);
      setChatMessageLineHeight(saved);
    } catch (err: unknown) {
      if (requestSeq !== chatMessageLineHeightSaveSeqRef.current) return;
      const fallback = persistedChatMessageLineHeightRef.current;
      latestChatMessageLineHeightRef.current = fallback;
      setChatMessageLineHeightValue(fallback);
      setChatMessageLineHeight(fallback);
      setChatMessageLineHeightError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestSeq === chatMessageLineHeightSaveSeqRef.current) setChatMessageLineHeightSaving(false);
    }
  }

  async function saveSleepInhibitor(enabled: boolean, duration: number) {
    setSleepInhibitorSaving(true);
    setSleepInhibitorError("");
    try {
      const res = await api.updateSettings({
        sleepInhibitorEnabled: enabled,
        sleepInhibitorDurationMinutes: duration,
      });
      setSleepInhibitorEnabled(res.sleepInhibitorEnabled ?? false);
      setSleepInhibitorDuration(res.sleepInhibitorDurationMinutes ?? 5);
    } catch (err: unknown) {
      setSleepInhibitorError(err instanceof Error ? err.message : String(err));
    } finally {
      setSleepInhibitorSaving(false);
    }
  }

  async function onRestartServer() {
    if (!confirm("Restart server? Browsers briefly disconnect. Sessions reconnect on demand when work needs backend."))
      return;

    restartAttemptSequenceRef.current += 1;
    const attemptSequence = restartAttemptSequenceRef.current;
    restartIntentRef.current?.cancel();
    restartIntentRef.current = null;
    if (healthPollRef.current) clearInterval(healthPollRef.current);
    if (healthTimeoutRef.current) clearTimeout(healthTimeoutRef.current);
    healthPollRef.current = null;
    healthTimeoutRef.current = null;
    const preRestartCompatibility = getBuildCompatibilitySnapshot();
    const previousServerBuildId =
      preRestartCompatibility.backendBuildId !== null &&
      preRestartCompatibility.backendBuildId === preRestartCompatibility.servedFrontendBuildId
        ? preRestartCompatibility.backendBuildId
        : null;

    const finishRestartAttempt = (serverIsReady = false): boolean => {
      if (restartAttemptSequenceRef.current !== attemptSequence) return false;
      restartAttemptSequenceRef.current += 1;
      restartIntentRef.current?.cancel();
      restartIntentRef.current = null;
      if (healthPollRef.current) clearInterval(healthPollRef.current);
      if (healthTimeoutRef.current) clearTimeout(healthTimeoutRef.current);
      healthPollRef.current = null;
      healthTimeoutRef.current = null;
      const store = useStore.getState();
      store.setServerRestarting(false);
      if (serverIsReady && !store.serverReachable) store.setServerReachable(true);
      setRestarting(false);
      return true;
    };

    setRestarting(true);
    setRestartError("");
    setRestartPrepResult(null);
    useStore.getState().setServerRestarting(true);

    try {
      const result = await api.restartServer();
      if (restartAttemptSequenceRef.current !== attemptSequence) return;
      const replacementBuildId =
        result.restartRequested === true && typeof result.replacementBuildId === "string"
          ? result.replacementBuildId.trim()
          : "";
      if (replacementBuildId) {
        restartIntentRef.current = createInitiatingTabRestartIntent(replacementBuildId, previousServerBuildId);
      }
    } catch (e: unknown) {
      // Typed API failures came from the still-running server and must remain
      // visible even when build tooling includes words such as "Failed". Only
      // transport failures are expected when the process exits mid-response.
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ApiError) {
        const result = e.body && typeof e.body === "object" ? (e.body as { result?: unknown }).result : undefined;
        if (isInterruptRestartBlockersResponse(result)) {
          setRestartPrepResult(result);
        }
        setRestartError(msg);
        finishRestartAttempt();
        return;
      }
      const isNetworkError = !msg || msg.includes("fetch") || msg.includes("Failed") || msg.includes("ECONNREFUSED");
      if (!isNetworkError) {
        setRestartError(msg);
        finishRestartAttempt();
        return;
      }
    }

    // Wait for both the backend and its production frontend to become usable.
    // Only the initiating tab receives the exact prepared build ID. Other tabs,
    // transport-only failures, and unrelated restarts retain the manual notice.
    healthPollRef.current = setInterval(async () => {
      if (restartAttemptSequenceRef.current !== attemptSequence) return;
      const observationSequence = beginBuildIdentityObservation();
      const readiness = await checkReadinessStatus();
      if (restartAttemptSequenceRef.current !== attemptSequence || !readiness.ok) return;

      const compatibility = observeServerBuildIdentity(
        readiness.buildId,
        readiness.servedFrontendBuildId,
        observationSequence,
      );
      const decision = restartIntentRef.current?.observe(readiness, compatibility) ?? "stop";
      if (decision === "wait") return;
      if (!finishRestartAttempt(true)) return;
      if (decision === "reload") onReloadAfterRestart();
    }, 2000);

    // Timeout after 120s
    healthTimeoutRef.current = setTimeout(() => {
      if (!finishRestartAttempt()) return;
      setRestartError("Server did not come back within 120 seconds. Check your terminal.");
    }, 120_000);
  }

  async function onSaveServerSlug(nextSlug: string) {
    setServerSlugSaving(true);
    setServerSlugError("");
    try {
      const res = await api.updateSettings({
        serverSlug: nextSlug.trim().toLowerCase(),
      });
      setServerSlug(res.serverSlug || "");
    } catch (err: unknown) {
      setServerSlugError(err instanceof Error ? err.message : String(err));
    } finally {
      setServerSlugSaving(false);
    }
  }

  useEffect(() => {
    if (!recordingShortcutActionId) return;
    const recorder = createShortcutGestureRecorder((binding) => {
      setShortcutOverride(recordingShortcutActionId, binding);
      setRecordingShortcutActionId(null);
    });

    function cancelShortcutRecord() {
      recorder.cancel();
      setRecordingShortcutActionId(null);
    }

    function handleShortcutRecordKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (!recordingShortcutActionId) return;
      if (event.key === "Escape") {
        cancelShortcutRecord();
        return;
      }
      recorder.keyDown(event);
    }

    function handleShortcutRecordKeyUp(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (!recordingShortcutActionId || event.key === "Escape") return;
      recorder.keyUp(event);
    }

    window.addEventListener("keydown", handleShortcutRecordKeyDown, true);
    window.addEventListener("keyup", handleShortcutRecordKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleShortcutRecordKeyDown, true);
      window.removeEventListener("keyup", handleShortcutRecordKeyUp, true);
      recorder.cancel();
    };
  }, [recordingShortcutActionId, setShortcutOverride]);

  const errorBox = (message: string) => (
    <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">{message}</div>
  );
  const binaryFields = [
    {
      which: "claude" as const,
      itemId: "claude",
      label: "Claude Code",
      value: claudeBin,
      testing: claudeTesting,
      test: claudeTest,
      onChange: (v: string) => {
        setClaudeBin(v);
        debouncedSaveBinaries(v, codexBin);
      },
    },
    {
      which: "codex" as const,
      itemId: "codex",
      label: "Codex",
      value: codexBin,
      testing: codexTesting,
      test: codexTest,
      onChange: (v: string) => {
        setCodexBin(v);
        debouncedSaveBinaries(claudeBin, v);
      },
    },
  ];

  return (
    <div
      ref={scrollRef}
      className={`${embedded ? "h-full" : "h-[100dvh]"} bg-cc-bg text-cc-fg font-sans-ui antialiased overflow-y-auto`}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10 space-y-4">
        <SettingsPageHeader embedded={embedded} onBack={navigateBackFromSettings} />

        {error && errorBox(error)}

        <SettingsSearchControls
          query={settingsSearch.query}
          setQuery={settingsSearch.setQuery}
          results={settingsSearch.results}
          activeSectionId={settingsSearch.activeSectionId}
          onJump={settingsSearch.jumpToSection}
        />

        <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
          <SettingsSectionNav
            results={settingsSearch.results}
            activeSectionId={settingsSearch.activeSectionId}
            onJump={settingsSearch.jumpToSection}
          />

          <div className="space-y-4">
            {/* ── Appearance ───────────────────────────────────────── */}
            <CollapsibleSection {...settingsSearch.sectionProps("appearance")}>
              <SettingsRow label="Theme" hidden={settingsSearch.rowHidden("appearance", "theme")}>
                <SegmentedControl
                  label="Theme"
                  options={COLOR_THEMES.map((theme) => ({
                    value: theme.id,
                    label: theme.label,
                  }))}
                  value={colorTheme}
                  onChange={setColorTheme}
                />
              </SettingsRow>
              <SettingsRow label="Zoom" htmlFor="settings-zoom" hidden={settingsSearch.rowHidden("appearance", "zoom")}>
                <NumberStepper
                  id="settings-zoom"
                  label="zoom"
                  value={Math.round(zoomLevel * 100)}
                  step={10}
                  min={20}
                  max={400}
                  suffix="%"
                  onChange={(percent) => setZoomLevel(percent / 100)}
                />
              </SettingsRow>
              <SettingsRow
                label="Chat Message Line Height"
                htmlFor="chat-message-line-height"
                hidden={settingsSearch.rowHidden("appearance", "chat-line-height")}
                description={
                  chatMessageLineHeightError ? (
                    <span className="text-cc-error">{chatMessageLineHeightError}</span>
                  ) : chatMessageLineHeightSaving ? (
                    "Saving..."
                  ) : (
                    "Spacing between lines of chat text."
                  )
                }
              >
                <NumberStepper
                  id="chat-message-line-height"
                  label="chat message line height"
                  value={chatMessageLineHeight}
                  step={0.05}
                  min={MIN_CHAT_MESSAGE_LINE_HEIGHT}
                  max={MAX_CHAT_MESSAGE_LINE_HEIGHT}
                  decimals={2}
                  suffix="×"
                  onChange={(next) => void saveChatMessageLineHeight(next)}
                />
              </SettingsRow>
              <SettingsToggle
                label="Compact Tool Activity"
                description="Collapse consecutive tool calls into a short summary you can expand."
                checked={compactToolActivity}
                onChange={toggleCompactToolActivity}
                hidden={settingsSearch.rowHidden("appearance", "compact-tool-activity")}
              />
              <SettingsToggle
                label="Expand Edit/Write Blocks"
                description="Show file edit diffs open by default."
                checked={editBlocksExpanded}
                onChange={toggleEditBlocksExpanded}
                hidden={settingsSearch.rowHidden("appearance", "edit-blocks")}
              />
              <SettingsToggle
                label="Usage Bars in Sidebar"
                checked={showUsageBars}
                onChange={toggleShowUsageBars}
                hidden={settingsSearch.rowHidden("appearance", "usage-bars")}
              />
              <SettingsLeaderProfilesSection
                hidden={settingsSearch.rowHidden("appearance", "leader-profiles")}
                poolsFromSettings={leaderProfilePools}
                loadOnMount={false}
              />
            </CollapsibleSection>

            {/* ── Keyboard ─────────────────────────────────────────── */}
            <CollapsibleSection {...settingsSearch.sectionProps("keyboard")}>
              <SendKeySchemeSetting
                shortcutPlatform={shortcutPlatform}
                hidden={settingsSearch.rowHidden("keyboard", "send-key")}
              />
              <SettingsShortcutSection
                shortcutSettings={shortcutSettings}
                setShortcutsEnabled={setShortcutsEnabled}
                setShortcutPreset={setShortcutPreset}
                setShortcutOverride={setShortcutOverride}
                resetShortcutOverrides={resetShortcutOverrides}
                recordingShortcutActionId={recordingShortcutActionId}
                setRecordingShortcutActionId={setRecordingShortcutActionId}
                shortcutPlatform={shortcutPlatform}
                hidden={settingsSearch.rowHidden("keyboard", "shortcuts")}
              />
            </CollapsibleSection>

            {/* ── Voice Input ──────────────────────────────────────── */}
            <CollapsibleSection {...settingsSearch.sectionProps("voice")}>
              <SettingsVoiceTranscriptionSection
                loading={loading}
                transcriptionApiKey={transcriptionApiKey}
                setTranscriptionApiKey={setTranscriptionApiKey}
                transcriptionBaseUrl={transcriptionBaseUrl}
                setTranscriptionBaseUrl={setTranscriptionBaseUrl}
                transcriptionModel={transcriptionModel}
                setTranscriptionModel={setTranscriptionModel}
                sttModel={sttModel}
                setSttModel={setSttModel}
                customSttModel={customSttModel}
                setCustomSttModel={setCustomSttModel}
                sttLanguageHints={sttLanguageHints}
                setSttLanguageHints={setSttLanguageHints}
                transcriptionEnhancement={transcriptionEnhancement}
                setTranscriptionEnhancement={setTranscriptionEnhancement}
                enhancementMode={enhancementMode}
                setEnhancementMode={setEnhancementMode}
                transcriptionVocabulary={transcriptionVocabulary}
                setTranscriptionVocabulary={setTranscriptionVocabulary}
                transcriptionSaving={transcriptionSaving}
                setTranscriptionSaving={setTranscriptionSaving}
                transcriptionSaved={transcriptionSaved}
                setTranscriptionSaved={setTranscriptionSaved}
                transcriptionError={transcriptionError}
                setTranscriptionError={setTranscriptionError}
              />
            </CollapsibleSection>

            {/* ── Notifications ────────────────────────────────────── */}
            <CollapsibleSection {...settingsSearch.sectionProps("notifications")}>
              <SettingsSubsection title="This Browser" hidden={settingsSearch.rowHidden("notifications", "browser")}>
                <SettingsToggle
                  label="Sound"
                  checked={notificationSound}
                  onChange={toggleNotificationSound}
                  hidden={settingsSearch.rowHidden("notifications", "sound")}
                />
                {notificationApiAvailable && (
                  <SettingsToggle
                    label="Desktop Alerts"
                    description="Show a system notification when a session needs attention."
                    checked={notificationDesktop}
                    hidden={settingsSearch.rowHidden("notifications", "desktop-alerts")}
                    onChange={async (next) => {
                      if (next && Notification.permission !== "granted") {
                        const result = await Notification.requestPermission();
                        if (result !== "granted") return;
                      }
                      setNotificationDesktop(next);
                    }}
                  />
                )}
              </SettingsSubsection>
              <SettingsPhoneAlertRules
                settings={loadedSettings}
                hidden={settingsSearch.rowHidden("notifications", "phone-alerts")}
              />
              <SettingsWebPushSection hidden={settingsSearch.rowHidden("notifications", "web-push")} />
              <SettingsPushoverSection
                settings={loadedSettings}
                loading={loading}
                hidden={settingsSearch.rowHidden("notifications", "pushover")}
              />
            </CollapsibleSection>

            {/* ── Sessions ─────────────────────────────────────────── */}
            <CollapsibleSection {...settingsSearch.sectionProps("sessions")}>
              <div hidden={settingsSearch.rowHidden("sessions", "session-defaults")}>
                <SettingsSessionDefaultsSection
                  isActive={isActive}
                  sessionDefaults={sessionDefaults}
                  onSaved={setSessionDefaults}
                />
              </div>

              <SettingsRow
                label="Codex Leader Context Mode"
                hidden={settingsSearch.rowHidden("sessions", "codex-leader-mode")}
                description="Default for new Codex leaders. Recycling keeps Takode-owned leader recovery; compacting lets Codex use built-in compaction. Manual /compact always compacts; /recycle recycles a leader once. Neither command changes this automatic mode."
              >
                <SegmentedControl
                  label="Codex Leader Context Mode"
                  options={[
                    { value: "recycle", label: "Recycle" },
                    { value: "compact", label: "Compact" },
                  ]}
                  value={codexLeaderCompactionMode}
                  onChange={(mode) => {
                    setCodexLeaderCompactionMode(mode);
                    api
                      .updateSettings({ codexLeaderCompactionMode: mode })
                      .then((res) =>
                        setCodexLeaderCompactionMode(normalizeCodexLeaderCompactionMode(res.codexLeaderCompactionMode)),
                      )
                      .catch(console.error);
                  }}
                />
              </SettingsRow>

              <SettingsSessionNamerSection
                settings={loadedSettings}
                loading={loading}
                hidden={settingsSearch.rowHidden("sessions", "session-namer")}
              />
              <SettingsSubsection
                title="Environments"
                description="Reusable environment variable profiles for new sessions."
                hidden={settingsSearch.rowHidden("sessions", "environments")}
              >
                <button
                  type="button"
                  onClick={() => {
                    window.location.hash = "#/environments";
                  }}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
                >
                  Manage Environments
                </button>
              </SettingsSubsection>
              <SettingsSessionDataSection hidden={settingsSearch.rowHidden("sessions", "session-data")} />
            </CollapsibleSection>

            {/* ── CLIs & Editor ────────────────────────────────────── */}
            <CollapsibleSection {...settingsSearch.sectionProps("cli")}>
              <SettingsSubsection
                title="Backend CLIs"
                description="Custom path or command for each backend CLI. Leave empty to auto-detect from PATH. New sessions use this immediately; existing sessions pick it up on relaunch."
                hidden={settingsSearch.rowHidden("cli", "cli")}
              >
                {binaryFields.map((field) => (
                  <div key={field.which} hidden={settingsSearch.rowHidden("cli", field.itemId)}>
                    <label className="block text-sm font-medium mb-1.5" htmlFor={`${field.which}-binary`}>
                      {field.label}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id={`${field.which}-binary`}
                        type="text"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        placeholder={`${field.which} (auto-detect)`}
                        className="flex-1 min-w-0 px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => onTestBinary(field.which)}
                        disabled={field.testing}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                          field.testing
                            ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                            : "bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer"
                        }`}
                      >
                        {field.testing ? "Testing..." : "Test"}
                      </button>
                    </div>
                    {field.test && (
                      <p className={`mt-1.5 text-xs ${field.test.ok ? "text-cc-success" : "text-cc-error"}`}>
                        {field.test.ok ? `${field.test.resolvedPath} — ${field.test.version}` : field.test.error}
                      </p>
                    )}
                  </div>
                ))}
                {binError && errorBox(binError)}
                {binSaving && <p className="text-xs text-cc-muted">Saving...</p>}
              </SettingsSubsection>

              <div hidden={settingsSearch.rowHidden("cli", "editor")}>
                <label className="block text-sm font-medium mb-1.5" htmlFor="editor-preference">
                  Editor
                </label>
                <select
                  id="editor-preference"
                  value={editorChoice}
                  onChange={(e) => onChangeEditor(e.target.value as EditorKind)}
                  className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
                >
                  <option value="vscode-local">VSCode (local)</option>
                  <option value="vscode-remote">VSCode (remote)</option>
                  <option value="cursor">Cursor</option>
                  <option value="none">None</option>
                </select>
                <p className="mt-1.5 text-xs text-cc-muted">
                  Used for clickable <code className="font-mono">file:</code> links in chat messages. Choose remote to
                  open files through the Takode server's VSCode extension on that machine.
                </p>
                {editorError && <div className="mt-1.5">{errorBox(editorError)}</div>}
                {editorSaving && <p className="mt-1.5 text-xs text-cc-muted">Saving...</p>}
              </div>
            </CollapsibleSection>

            {/* ── Performance & Power ──────────────────────────────── */}
            <CollapsibleSection
              {...settingsSearch.sectionProps("performance")}
              onCollapsedChange={setPerformanceCollapsed}
            >
              <SettingsRow
                label="Max Keep-Alive"
                htmlFor="max-keep-alive"
                hidden={settingsSearch.rowHidden("performance", "max-keep-alive")}
                description="Maximum number of live CLI processes. Set to 0 for unlimited. Oldest idle sessions are killed first. Busy sessions are never killed."
              >
                <input
                  id="max-keep-alive"
                  type="number"
                  min={0}
                  step={1}
                  value={maxKeepAlive}
                  onChange={(e) => {
                    const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                    setMaxKeepAlive(v);
                    debouncedSaveLifecycle(v);
                  }}
                  className="w-20 px-2 py-1 text-right text-sm bg-cc-input-bg border border-cc-border rounded-md text-cc-fg focus:outline-none focus:border-cc-primary/60"
                />
              </SettingsRow>
              {lifecycleError && errorBox(lifecycleError)}
              {lifecycleSaving && <p className="text-xs text-cc-muted">Saving...</p>}

              <SettingsToggle
                label="Heavy Repo Mode"
                description="Return cached session rows without list-driven background git refresh. Useful for large repos or slow filesystems; selected-session and explicit refreshes still update git metadata."
                checked={heavyRepoModeEnabled}
                disabled={heavyRepoSaving}
                hidden={settingsSearch.rowHidden("performance", "heavy-repo")}
                onChange={(next) => {
                  setHeavyRepoModeEnabled(next);
                  void saveHeavyRepoMode(next);
                }}
              />
              {heavyRepoError && errorBox(heavyRepoError)}

              <div className="space-y-3" hidden={settingsSearch.rowHidden("performance", "sleep-inhibitor")}>
                <SettingsToggle
                  label="Prevent Sleep During Generation"
                  description="Keep your Mac awake while sessions are actively generating. Applies to every session on this Takode server. Uses macOS caffeinate; no effect on other platforms."
                  checked={sleepInhibitorEnabled}
                  disabled={sleepInhibitorSaving}
                  onChange={(next) => {
                    setSleepInhibitorEnabled(next);
                    void saveSleepInhibitor(next, sleepInhibitorDuration);
                  }}
                />
                {sleepInhibitorEnabled && <CaffeinateStatusLine status={caffeinateStatus} tick={caffeinateTick} />}
                {sleepInhibitorEnabled && (
                  <SettingsRow
                    label="Grace Period"
                    htmlFor="sleep-inhibitor-duration"
                    description="Each poll (every 60s) resets the timer while any session is generating."
                  >
                    <NumberStepper
                      id="sleep-inhibitor-duration"
                      label="grace period"
                      value={sleepInhibitorDuration}
                      step={1}
                      min={1}
                      max={240}
                      suffix="min"
                      onChange={(v) => {
                        setSleepInhibitorDuration(v);
                        void saveSleepInhibitor(sleepInhibitorEnabled, v);
                      }}
                    />
                  </SettingsRow>
                )}
                {sleepInhibitorError && errorBox(sleepInhibitorError)}
              </div>
            </CollapsibleSection>

            {/* ── Remote Hosts ─────────────────────────────────────── */}
            <CollapsibleSection {...settingsSearch.sectionProps("hosts")}>
              <SettingsHostsSection />
            </CollapsibleSection>

            {/* ── Server ───────────────────────────────────────────── */}
            <CollapsibleSection {...settingsSearch.sectionProps("server")}>
              <SettingsLoginSection hidden={settingsSearch.rowHidden("server", "login")} />
              <SettingsServerDiagnosticsSection
                logFile={logFile}
                serverSlug={serverSlug}
                setServerSlug={setServerSlug}
                serverSlugSaving={serverSlugSaving}
                serverSlugError={serverSlugError}
                restartSupported={restartSupported}
                restartError={restartError}
                restartPrepResult={restartPrepResult}
                restarting={restarting}
                onSaveServerSlug={onSaveServerSlug}
                onRestartServer={onRestartServer}
                isRowHidden={(itemId) => settingsSearch.rowHidden("server", itemId)}
              />
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Live caffeinate state for the sleep inhibitor; `tick` only forces the per-second re-render. */
function CaffeinateStatusLine({
  status,
  tick,
}: {
  status: {
    active: boolean;
    engagedAt: number | null;
    expiresAt: number | null;
  };
  tick: number;
}) {
  void tick;
  const now = Date.now();
  const { active, engagedAt, expiresAt } = status;
  const fmtDuration = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };
  const remaining = expiresAt ? expiresAt - now : 0;
  if (!active || !engagedAt || !expiresAt || remaining <= 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cc-hover text-xs text-cc-muted">
        <span className="w-2 h-2 rounded-full bg-cc-muted/40 shrink-0" />
        <span>
          {active && engagedAt && expiresAt ? "Idle -- caffeinate expired" : "Idle -- no sessions generating"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cc-hover text-xs text-cc-fg">
      <span className="w-2 h-2 rounded-full bg-green-500 shrink-0 animate-pulse" />
      <span>
        Awake for {fmtDuration(now - engagedAt)} · expires in {fmtDuration(remaining)}
      </span>
    </div>
  );
}
