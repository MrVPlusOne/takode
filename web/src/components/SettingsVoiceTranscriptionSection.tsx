import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import { api, type TranscriptionConfig } from "../api.js";
import { GPT_TRANSCRIBE_LANGUAGE_HINTS } from "../../shared/transcription-language-hints.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { EnhancementTester } from "./EnhancementTester.js";
import { TranscriptionDebugPanel } from "./TranscriptionDebugPanel.js";

export const DEFAULT_STT_MODEL = "gpt-transcribe";
export const CUSTOM_STT_MODEL_VALUE = "__custom__";
export const BUILT_IN_STT_MODELS = [
  "gpt-transcribe",
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
] as const;

type SectionSearchProps = Pick<ComponentProps<typeof CollapsibleSection>, "hidden" | "searchQuery" | "matchCount">;

interface SettingsVoiceTranscriptionSectionProps {
  loading: boolean;
  sectionSearchProps: SectionSearchProps;
  transcriptionApiKey: string;
  setTranscriptionApiKey: Dispatch<SetStateAction<string>>;
  transcriptionBaseUrl: string;
  setTranscriptionBaseUrl: Dispatch<SetStateAction<string>>;
  transcriptionModel: string;
  setTranscriptionModel: Dispatch<SetStateAction<string>>;
  sttModel: string;
  setSttModel: Dispatch<SetStateAction<string>>;
  customSttModel: string;
  setCustomSttModel: Dispatch<SetStateAction<string>>;
  sttLanguageHints: string[];
  setSttLanguageHints: Dispatch<SetStateAction<string[]>>;
  transcriptionEnhancement: boolean;
  setTranscriptionEnhancement: Dispatch<SetStateAction<boolean>>;
  enhancementMode: "default" | "bullet";
  setEnhancementMode: Dispatch<SetStateAction<"default" | "bullet">>;
  transcriptionVocabulary: string;
  setTranscriptionVocabulary: Dispatch<SetStateAction<string>>;
  transcriptionSaving: boolean;
  setTranscriptionSaving: Dispatch<SetStateAction<boolean>>;
  transcriptionSaved: boolean;
  setTranscriptionSaved: Dispatch<SetStateAction<boolean>>;
  transcriptionError: string;
  setTranscriptionError: Dispatch<SetStateAction<string>>;
}

export function SettingsVoiceTranscriptionSection({
  loading,
  sectionSearchProps,
  transcriptionApiKey,
  setTranscriptionApiKey,
  transcriptionBaseUrl,
  setTranscriptionBaseUrl,
  transcriptionModel,
  setTranscriptionModel,
  sttModel,
  setSttModel,
  customSttModel,
  setCustomSttModel,
  sttLanguageHints,
  setSttLanguageHints,
  transcriptionEnhancement,
  setTranscriptionEnhancement,
  enhancementMode,
  setEnhancementMode,
  transcriptionVocabulary,
  setTranscriptionVocabulary,
  transcriptionSaving,
  setTranscriptionSaving,
  transcriptionSaved,
  setTranscriptionSaved,
  transcriptionError,
  setTranscriptionError,
}: SettingsVoiceTranscriptionSectionProps) {
  const [languageSearch, setLanguageSearch] = useState("");
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [activeLanguageIndex, setActiveLanguageIndex] = useState(0);
  const languagePickerRef = useRef<HTMLDivElement>(null);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);
  const languageSearchRef = useRef<HTMLInputElement>(null);
  const languagePickerId = useId();
  const languageListboxId = `${languagePickerId}-listbox`;
  const isGptTranscribeSelected = sttModel === DEFAULT_STT_MODEL;
  const selectedLanguageHintSet = useMemo(() => new Set(sttLanguageHints), [sttLanguageHints]);
  const filteredLanguageHints = useMemo(() => {
    const query = languageSearch.trim().toLowerCase();
    return GPT_TRANSCRIBE_LANGUAGE_HINTS.filter(
      (hint) =>
        !selectedLanguageHintSet.has(hint.code) &&
        (!query || hint.code.includes(query) || hint.name.toLowerCase().includes(query)),
    );
  }, [languageSearch, selectedLanguageHintSet]);

  function closeLanguagePicker(restoreFocus: boolean) {
    setLanguagePickerOpen(false);
    setLanguageSearch("");
    setActiveLanguageIndex(0);
    if (restoreFocus) languageTriggerRef.current?.focus();
  }

  function addLanguageHint(code: string) {
    setSttLanguageHints((current) => (current.includes(code) ? current : [...current, code]));
    closeLanguagePicker(true);
  }

  function removeLanguageHint(code: string) {
    setSttLanguageHints((current) => current.filter((hint) => hint !== code));
  }

  useEffect(() => {
    if (!languagePickerOpen) return;
    languageSearchRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!languagePickerRef.current?.contains(event.target as Node)) closeLanguagePicker(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeLanguagePicker(true);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [languagePickerOpen]);

  useEffect(() => {
    if (!isGptTranscribeSelected && languagePickerOpen) closeLanguagePicker(false);
  }, [isGptTranscribeSelected, languagePickerOpen]);

  function handleLanguageSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveLanguageIndex((current) =>
        filteredLanguageHints.length === 0 ? 0 : (current + 1) % filteredLanguageHints.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveLanguageIndex((current) =>
        filteredLanguageHints.length === 0
          ? 0
          : (current - 1 + filteredLanguageHints.length) % filteredLanguageHints.length,
      );
    } else if (event.key === "Enter" && filteredLanguageHints[activeLanguageIndex]) {
      event.preventDefault();
      addLanguageHint(filteredLanguageHints[activeLanguageIndex].code);
    }
  }

  async function saveTranscriptionSettings() {
    setTranscriptionError("");
    setTranscriptionSaved(false);
    const resolvedSttModel = sttModel === CUSTOM_STT_MODEL_VALUE ? customSttModel.trim() : sttModel.trim();
    if (!resolvedSttModel) {
      setTranscriptionError("Custom STT model is required.");
      return;
    }
    setTranscriptionSaving(true);
    try {
      const config: TranscriptionConfig = {
        apiKey: transcriptionApiKey === "***" ? "***" : transcriptionApiKey,
        baseUrl: transcriptionBaseUrl,
        enhancementEnabled: transcriptionEnhancement,
        enhancementModel: transcriptionModel,
        customVocabulary: transcriptionVocabulary,
        enhancementMode,
        sttModel: resolvedSttModel,
        sttLanguageHints,
      };
      await api.updateSettings({ transcriptionConfig: config });
      if (sttModel === CUSTOM_STT_MODEL_VALUE) setCustomSttModel(resolvedSttModel);
      setTranscriptionSaved(true);
      setTimeout(() => setTranscriptionSaved(false), 3000);
    } catch (err: unknown) {
      setTranscriptionError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscriptionSaving(false);
    }
  }

  return (
    <CollapsibleSection
      id="voice-transcription"
      title="Voice Transcription"
      description="Configure the OpenAI-compatible Whisper API for voice-to-text input. Optionally enable LLM enhancement to clean up transcribed text before sending."
      {...sectionSearchProps}
    >
      <div className="space-y-3 pl-3 border-l-2 border-cc-border">
        <div>
          <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="transcription-api-key">
            API Key
          </label>
          <input
            id="transcription-api-key"
            type="password"
            value={transcriptionApiKey}
            onChange={(e) => setTranscriptionApiKey(e.target.value)}
            onFocus={() => {
              if (transcriptionApiKey === "***") setTranscriptionApiKey("");
            }}
            placeholder="sk-..."
            className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="transcription-base-url">
            Base URL
          </label>
          <input
            id="transcription-base-url"
            type="text"
            value={transcriptionBaseUrl}
            onChange={(e) => setTranscriptionBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 font-mono"
          />
          <p className="mt-1 text-xs text-cc-muted">
            Leave empty for OpenAI. Use a custom URL for Groq, local Whisper, etc.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="stt-model">
            STT Model
          </label>
          <select
            id="stt-model"
            value={sttModel}
            onChange={(e) => setSttModel(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 font-mono"
          >
            {BUILT_IN_STT_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
            <option value={CUSTOM_STT_MODEL_VALUE}>Custom Model</option>
          </select>
        </div>
        {sttModel === CUSTOM_STT_MODEL_VALUE && (
          <div>
            <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="custom-stt-model">
              Custom STT Model
            </label>
            <input
              id="custom-stt-model"
              type="text"
              value={customSttModel}
              onChange={(e) => setCustomSttModel(e.target.value)}
              placeholder="whisper-large-v3"
              className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 font-mono"
            />
          </div>
        )}
        {isGptTranscribeSelected && (
          <div>
            <div className="block text-xs font-medium text-cc-muted mb-1.5" id="stt-language-label">
              Expected Languages
            </div>
            <div
              ref={languagePickerRef}
              className="space-y-2 rounded-lg border border-cc-border bg-cc-input-bg/40 p-2"
              aria-labelledby="stt-language-label"
            >
              {sttLanguageHints.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sttLanguageHints.map((code) => {
                    const hint = GPT_TRANSCRIBE_LANGUAGE_HINTS.find((candidate) => candidate.code === code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => removeLanguageHint(code)}
                        className="rounded-full border border-cc-border bg-cc-hover px-2 py-1 text-xs text-cc-fg"
                        aria-label={`Remove ${hint?.name ?? code} (${code})`}
                      >
                        {hint?.name ?? code} <span className="font-mono">{code}</span> ×
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                ref={languageTriggerRef}
                type="button"
                aria-label="Add expected language"
                aria-expanded={languagePickerOpen}
                aria-controls={languagePickerId}
                aria-haspopup="listbox"
                onClick={() => {
                  if (languagePickerOpen) {
                    closeLanguagePicker(false);
                  } else {
                    setLanguageSearch("");
                    setActiveLanguageIndex(0);
                    setLanguagePickerOpen(true);
                  }
                }}
                className="flex w-full items-center justify-between rounded-lg border border-cc-border bg-cc-input-bg px-3 py-2 text-left text-sm text-cc-muted hover:text-cc-fg focus:outline-none focus:border-cc-primary/60"
              >
                <span>Search language name or code…</span>
                <span aria-hidden="true">+</span>
              </button>
              {languagePickerOpen && (
                <div id={languagePickerId} className="space-y-1.5">
                  <input
                    ref={languageSearchRef}
                    id="stt-language-search"
                    type="search"
                    role="combobox"
                    aria-label="Search expected languages"
                    aria-expanded="true"
                    aria-controls={languageListboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      filteredLanguageHints[activeLanguageIndex]
                        ? `${languageListboxId}-option-${filteredLanguageHints[activeLanguageIndex].code}`
                        : undefined
                    }
                    value={languageSearch}
                    onChange={(event) => {
                      setLanguageSearch(event.target.value);
                      setActiveLanguageIndex(0);
                    }}
                    onKeyDown={handleLanguageSearchKeyDown}
                    placeholder="Search language name or code…"
                    className="w-full px-3 py-2 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60"
                  />
                  <div
                    id={languageListboxId}
                    role="listbox"
                    aria-label="Expected language options"
                    className="max-h-40 overflow-y-auto space-y-1"
                  >
                    {filteredLanguageHints.length === 0 ? (
                      <p className="px-2 py-1.5 text-xs text-cc-muted">No matching languages.</p>
                    ) : (
                      filteredLanguageHints.map((hint, index) => (
                        <button
                          id={`${languageListboxId}-option-${hint.code}`}
                          key={hint.code}
                          type="button"
                          role="option"
                          aria-selected={index === activeLanguageIndex}
                          tabIndex={-1}
                          onPointerMove={() => setActiveLanguageIndex(index)}
                          onClick={() => addLanguageHint(hint.code)}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
                            index === activeLanguageIndex
                              ? "bg-cc-primary/15 text-cc-fg"
                              : "text-cc-muted hover:bg-cc-hover"
                          }`}
                        >
                          <span>{hint.name}</span>
                          <span className="font-mono text-[11px]">{hint.code}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-cc-muted">
              Optional gpt-transcribe input-language hints. This is a conservative static list based on documented
              OpenAI-supported code formats, not live-provider validation.
            </p>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="transcription-model">
            Enhancement Model
          </label>
          <input
            id="transcription-model"
            type="text"
            value={transcriptionModel}
            onChange={(e) => setTranscriptionModel(e.target.value)}
            placeholder="gpt-5-mini"
            className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 font-mono"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-cc-fg cursor-pointer">
          <input
            type="checkbox"
            checked={transcriptionEnhancement}
            onChange={(e) => setTranscriptionEnhancement(e.target.checked)}
            className="accent-cc-primary"
          />
          Enable Enhancement
        </label>
        {transcriptionEnhancement && (
          <div>
            <label className="block text-xs font-medium text-cc-muted mb-1.5">Enhancement Style</label>
            <select
              value={enhancementMode}
              onChange={(e) => setEnhancementMode(e.target.value as "default" | "bullet")}
              className="w-full bg-cc-input-bg text-cc-fg border border-cc-border rounded-lg px-3 py-2 text-xs"
            >
              <option value="default">Prose</option>
              <option value="bullet">Bullet Points</option>
            </select>
            <p className="mt-1 text-xs text-cc-muted">
              Prose outputs clean paragraphs. Bullet Points structures dictation as organized lists.
            </p>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-cc-muted mb-1.5" htmlFor="transcription-vocabulary">
            Custom Vocabulary
          </label>
          <input
            id="transcription-vocabulary"
            type="text"
            value={transcriptionVocabulary}
            onChange={(e) => setTranscriptionVocabulary(e.target.value)}
            placeholder="Takode, LiteLLM, worktree, mai-agents"
            className="w-full px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg focus:outline-none focus:border-cc-primary/60 font-mono"
          />
          <p className="mt-1 text-xs text-cc-muted">
            Comma-separated terms the STT model frequently mishears. Injected as vocabulary hints.
          </p>
        </div>
      </div>

      {transcriptionError && (
        <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
          {transcriptionError}
        </div>
      )}
      {transcriptionSaved && (
        <div className="px-3 py-2 rounded-lg bg-cc-success/10 border border-cc-success/20 text-xs text-cc-success">
          Voice transcription settings saved.
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={transcriptionSaving || loading}
          onClick={saveTranscriptionSettings}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            transcriptionSaving || loading
              ? "bg-cc-hover text-cc-muted cursor-not-allowed"
              : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
          }`}
        >
          {transcriptionSaving ? "Saving..." : "Save"}
        </button>
      </div>

      <TranscriptionDebugPanel />
      <EnhancementTester />
    </CollapsibleSection>
  );
}
