import type { ScenicBackground } from "../../shared/scenic-background.js";
import { scenicAsset } from "../scenic/ScenicBackdrop.js";
import { SCENIC_STYLES } from "../scenic/scenic-styles.js";
import { useStore } from "../store.js";

/**
 * Settings > Appearance: pick a scenic background (a painted landscape behind the conversation)
 * or Off. Each choice is a tile with a small picture of its painting in the current theme's day or
 * night version; the choice is saved on the server for every browser.
 */
export function SettingsScenicBackgroundSection({ hidden = false }: { hidden?: boolean }) {
  const value = useStore((state) => state.scenicBackground);
  const setValue = useStore((state) => state.setScenicBackground);
  const dark = useStore((state) => state.darkMode);
  const options: Array<{ id: ScenicBackground; label: string }> = [{ id: "off", label: "Off" }, ...SCENIC_STYLES];
  return (
    <div
      hidden={hidden}
      className="space-y-2 rounded-lg bg-cc-hover px-3 py-2.5"
      data-testid="settings-scenic-background"
    >
      <div>
        <div className="text-sm text-cc-fg">Scenic Background</div>
        <p className="mt-0.5 text-xs text-cc-muted">
          A painted landscape behind the conversation, in a day version for the light theme and a night version for the
          dark theme. It moves very gently, and stays still when your device asks for reduced motion.
        </p>
      </div>
      <div role="radiogroup" aria-label="Scenic Background" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setValue(option.id)}
              className={`group overflow-hidden rounded-lg border text-left transition-colors cursor-pointer ${
                selected ? "border-cc-primary ring-2 ring-cc-primary/30" : "border-cc-border hover:border-cc-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className="block aspect-[16/10] w-full bg-cc-bg bg-cover bg-center"
                style={
                  option.id === "off"
                    ? undefined
                    : { backgroundImage: `url("${scenicAsset(`${option.id}-${dark ? "night" : "day"}-thumb`)}")` }
                }
              />
              <span
                className={`block truncate px-2 py-1.5 text-xs ${selected ? "text-cc-primary font-medium" : "text-cc-fg"}`}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
