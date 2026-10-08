import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { SettingsSubsection, SwitchTrack } from "./settings-controls.js";
import {
  DEFAULT_LEADER_PROFILE_POOLS,
  LEADER_PROFILE_POOLS,
  LEADER_PROFILE_PORTRAITS,
  type LeaderProfilePoolSettings,
} from "../../shared/leader-profile-portraits.js";

interface SettingsLeaderProfilesSectionProps {
  hidden?: boolean;
  poolsFromSettings?: LeaderProfilePoolSettings;
  loadOnMount?: boolean;
}

export function SettingsLeaderProfilesSection({
  hidden = false,
  poolsFromSettings,
  loadOnMount = true,
}: SettingsLeaderProfilesSectionProps) {
  const [pools, setPools] = useState<LeaderProfilePoolSettings>(poolsFromSettings ?? DEFAULT_LEADER_PROFILE_POOLS);
  const [loading, setLoading] = useState(true);
  const [savingPool, setSavingPool] = useState<string | null>(null);
  const [error, setError] = useState("");
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (poolsFromSettings) {
      setPools(poolsFromSettings);
    }
  }, [poolsFromSettings]);

  useEffect(() => {
    if (!loadOnMount) {
      setLoading(false);
      return;
    }
    let active = true;
    api
      .getSettings()
      .then((settings) => {
        if (active) setPools(settings.leaderProfilePools ?? DEFAULT_LEADER_PROFILE_POOLS);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadOnMount]);

  const countsByPool = useMemo(() => {
    const counts = new Map<string, number>();
    for (const portrait of LEADER_PROFILE_PORTRAITS) {
      counts.set(portrait.poolId, (counts.get(portrait.poolId) ?? 0) + 1);
    }
    return counts;
  }, []);

  async function togglePool(poolId: keyof LeaderProfilePoolSettings) {
    if (loading || saveInFlightRef.current) return;
    const next = { ...pools, [poolId]: !pools[poolId] };
    saveInFlightRef.current = true;
    setSavingPool(poolId);
    setError("");
    try {
      const settings = await api.updateSettings({ leaderProfilePools: next });
      setPools(settings.leaderProfilePools ?? next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      saveInFlightRef.current = false;
      setSavingPool(null);
    }
  }

  const savingAnyPool = savingPool !== null;

  return (
    <SettingsSubsection
      title="Leader Profile Pictures"
      description="Picture sets that new leader sessions pick their profile picture from."
      hidden={hidden}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {LEADER_PROFILE_POOLS.map((pool) => {
          const enabled = pools[pool.id];
          const saving = savingPool === pool.id;
          return (
            <button
              key={pool.id}
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={loading || savingAnyPool}
              onClick={() => togglePool(pool.id)}
              className={`flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                enabled
                  ? "border-cc-primary/35 bg-cc-primary/10 text-cc-fg"
                  : "border-cc-border bg-cc-hover/60 text-cc-muted hover:bg-cc-hover"
              } ${loading || savingAnyPool ? "cursor-wait opacity-70" : "cursor-pointer"}`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{pool.label}</span>
                <span className="block text-xs text-cc-muted">
                  {countsByPool.get(pool.id) ?? 0} portraits
                  {saving ? " - saving" : ""}
                </span>
              </span>
              <SwitchTrack checked={enabled} />
            </button>
          );
        })}
      </div>
      {error && (
        <div className="rounded-lg border border-cc-error/20 bg-cc-error/10 px-3 py-2 text-xs text-cc-error">
          {error}
        </div>
      )}
    </SettingsSubsection>
  );
}
