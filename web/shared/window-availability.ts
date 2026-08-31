export interface DirectionalWindowAvailability {
  has_older_items: boolean;
  has_newer_items: boolean;
}

export interface WindowAvailabilityBounds {
  from: number;
  count: number;
  total: number;
}

export function deriveWindowAvailability(bounds: WindowAvailabilityBounds): DirectionalWindowAvailability {
  const total = Math.max(0, Math.floor(bounds.total));
  if (total === 0) {
    return { has_older_items: false, has_newer_items: false };
  }

  const from = Math.max(0, Math.min(Math.floor(bounds.from), total - 1));
  const count = Math.max(0, Math.floor(bounds.count));
  const endExclusive = Math.min(total, from + count);

  return {
    has_older_items: from > 0,
    has_newer_items: endExclusive < total,
  };
}
