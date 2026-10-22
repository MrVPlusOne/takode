import { useEffect, useState } from "react";
import {
  acceptAnimalPortraitsOffer,
  dismissAnimalPortraitsOffer,
  getAnimalPortraitsOffer,
} from "../api/animal-portraits-offer.js";
import { refreshActiveSessionMetadata } from "../session-list-hydration.js";
import { LEADER_PROFILE_PORTRAITS } from "../../shared/leader-profile-portraits.js";

const SAMPLE_PORTRAITS = LEADER_PROFILE_PORTRAITS.filter((portrait) => portrait.poolId === "animals").slice(1, 4);

/**
 * One-time offer, after the upgrade that made Animals the default portrait set, for installs still
 * using the cat sets. The server decides whether to show it and records the answer, so it never
 * returns on any device. The user chooses whether current leaders change too, since Takode can't
 * tell portraits picked by hand from assigned ones.
 */
export function AnimalPortraitsOffer() {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAnimalPortraitsOffer()
      .then((body) => !cancelled && setShow(body.show))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  async function accept(currentLeaders: boolean) {
    setSaving(true);
    setError("");
    try {
      const result = await acceptAnimalPortraitsOffer(currentLeaders);
      setShow(false);
      // Show the new portraits now rather than at the next session list poll.
      if (result.reassignedLeaders > 0) void refreshActiveSessionMetadata({ force: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function dismiss() {
    setShow(false);
    dismissAnimalPortraitsOffer().catch((err) => console.warn("[portraits] failed to save dismissal:", err));
  }

  return (
    <div
      className="px-4 py-2 border-b border-cc-border bg-cc-hover/60 text-xs flex flex-wrap items-center gap-x-3 gap-y-2"
      data-testid="animal-portraits-offer"
    >
      <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
        {SAMPLE_PORTRAITS.map((portrait) => (
          <img
            key={portrait.id}
            src={portrait.smallUrl}
            alt=""
            width={portrait.smallSize}
            height={portrait.smallSize}
            className="h-6 w-6 rounded-full object-cover ring-2 ring-cc-bg"
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 basis-56 text-cc-fg">
        New animal portraits for leaders are easier to tell apart than the cats. Switch to them?
        {error && <span className="ml-2 text-cc-error">{error}</span>}
      </span>
      <span className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          className="px-2.5 py-1 rounded-md bg-cc-primary text-white disabled:opacity-60"
          onClick={() => accept(true)}
        >
          Switch all leaders
        </button>
        <button
          type="button"
          disabled={saving}
          className="px-2.5 py-1 rounded-md border border-cc-border text-cc-fg disabled:opacity-60"
          onClick={() => accept(false)}
        >
          New leaders only
        </button>
        <button type="button" disabled={saving} className="px-2.5 py-1 rounded-md text-cc-muted" onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
