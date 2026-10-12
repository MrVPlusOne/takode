import { useEffect, useState } from "react";
import { api, type AppSettings } from "../api.js";
import {
  DEFAULT_WORKER_SLOT_LIMITS,
  MAX_WORKER_SLOT_LIMIT,
  type WorkerSlotLimits,
} from "../../shared/takode-constants.js";
import { NumberStepper, SettingsRow, SettingsSubsection } from "./settings-controls.js";

const BACKENDS: Array<{ key: keyof WorkerSlotLimits; label: string }> = [
  { key: "claude", label: "Claude leaders" },
  { key: "codex", label: "Codex leaders" },
];

/**
 * How many workers a leader may keep in its herd, per leader backend. Each change saves
 * at once and applies to the next spawn, list or board check.
 */
export function SettingsWorkerSlotsSection({
  settings,
  hidden = false,
}: {
  settings: AppSettings | null;
  hidden?: boolean;
}) {
  const [limits, setLimits] = useState<WorkerSlotLimits>(DEFAULT_WORKER_SLOT_LIMITS);
  const [error, setError] = useState("");

  useEffect(() => {
    if (settings?.workerSlotLimits) setLimits(settings.workerSlotLimits);
  }, [settings]);

  async function save(backend: keyof WorkerSlotLimits, limit: number) {
    const previous = limits;
    setLimits({ ...limits, [backend]: limit });
    setError("");
    try {
      const res = await api.updateSettings({ workerSlotLimits: { [backend]: limit } });
      setLimits(res.workerSlotLimits);
    } catch (err: unknown) {
      setLimits(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsSubsection
      title="Worker Slots"
      description="Most workers a leader keeps at once, by the leader's backend. Reviewers do not count. A higher limit only raises the ceiling: leaders still dispatch in parallel only when the work allows it."
      hidden={hidden}
    >
      {BACKENDS.map(({ key, label }) => (
        <SettingsRow key={key} label={label} htmlFor={`worker-slots-${key}`}>
          <NumberStepper
            id={`worker-slots-${key}`}
            label={`${label} worker slots`}
            value={limits[key]}
            step={1}
            min={1}
            max={MAX_WORKER_SLOT_LIMIT}
            suffix="workers"
            onChange={(next) => void save(key, next)}
          />
        </SettingsRow>
      ))}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
          {error}
        </div>
      )}
    </SettingsSubsection>
  );
}
