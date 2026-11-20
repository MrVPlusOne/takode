import type { TypingThrow, TypingThrows } from "../../shared/typing-effect.js";
import { useStore } from "../store.js";
import { SegmentedControl } from "./settings-controls.js";

const THROW_OPTIONS: Array<{ value: TypingThrow; label: string }> = [
  { value: "sparks", label: "Sparks" },
  { value: "glints", label: "Gold glints" },
  { value: "leaf", label: "Gold leaf" },
];

/**
 * How each preview box looks: the theme it shows, whatever the page's own theme, so either theme's
 * effect can be tried from either.
 */
const PREVIEW_LOOK: Record<keyof TypingThrows, { background: string; border: string; color: string }> = {
  light: { background: "#fbf9f4", border: "#e3ddd2", color: "#2b2622" },
  dark: { background: "#1f1e1c", border: "#3a3733", color: "#ece8e1" },
};

/**
 * Settings > Appearance: the typing effect. When it plays (Off, With Background, Always), what each
 * key throws in the light and in the dark theme, and for each theme a box to type in and try the
 * chosen effect, which plays there whatever the other settings.
 */
export function SettingsTypingEffectSection({ hidden = false }: { hidden?: boolean }) {
  const effect = useStore((state) => state.typingEffect);
  const setEffect = useStore((state) => state.setTypingEffect);
  const throws = useStore((state) => state.typingThrows);
  const setThrow = useStore((state) => state.setTypingThrow);
  return (
    <div
      hidden={hidden}
      className="space-y-3 rounded-lg bg-cc-hover px-3 py-2.5 text-cc-fg"
      data-testid="settings-typing-effect"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-[10rem] flex-1">
          <div className="text-sm">Typing Effect</div>
          <p className="mt-0.5 text-xs text-cc-muted">
            While you type in the message, side chat, comment and answer boxes, the caret glows like hot iron and each
            key throws a small burst. With Background plays it only while a scenic background is on.
          </p>
        </div>
        <SegmentedControl
          label="Typing effect"
          options={[
            { value: "off", label: "Off" },
            { value: "scenic", label: "With Background" },
            { value: "always", label: "Always" },
          ]}
          value={effect}
          onChange={setEffect}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["light", "dark"] as const).map((theme) => (
          <ThemeThrow key={theme} theme={theme} value={throws[theme]} onChange={(choice) => setThrow(theme, choice)} />
        ))}
      </div>
    </div>
  );
}

/** One theme's throw: its dropdown and a box in that theme to try it. */
function ThemeThrow({
  theme,
  value,
  onChange,
}: {
  theme: keyof TypingThrows;
  value: TypingThrow;
  onChange: (choice: TypingThrow) => void;
}) {
  const label = theme === "light" ? "Light theme" : "Dark theme";
  const look = PREVIEW_LOOK[theme];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-cc-muted" htmlFor={`typing-throw-${theme}`}>
          {label}
        </label>
        <select
          id={`typing-throw-${theme}`}
          value={value}
          onChange={(event) => onChange(event.target.value as TypingThrow)}
          className="rounded-md border border-cc-border bg-cc-input-bg px-2 py-1 text-xs text-cc-fg focus:outline-none focus:border-cc-primary/60"
        >
          {THROW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div
        data-typing-frame
        data-typing-theme={theme}
        className="relative rounded-lg border"
        style={{ background: look.background, borderColor: look.border }}
      >
        <textarea
          data-chat-input
          data-typing-preview
          data-typing-throw={value}
          aria-label={`Try the typing effect in the ${theme} theme`}
          placeholder="Type here to try it"
          rows={2}
          spellCheck={false}
          className="block w-full resize-none bg-transparent px-3 py-2 text-sm placeholder:opacity-50 focus:outline-none"
          style={{ color: look.color }}
        />
      </div>
    </div>
  );
}
