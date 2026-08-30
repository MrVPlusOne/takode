export type ValueEquality<T> = (left: T, right: T) => boolean;

export function reuseIfEqual<T>(previous: T, next: T, equal: ValueEquality<T>): T {
  return equal(previous, next) ? previous : next;
}

export function reconcileValue<T>(previous: T | undefined, next: T, equal: ValueEquality<T>): T {
  return previous === undefined ? next : reuseIfEqual(previous, next, equal);
}

export function arraysEqual<T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>, equal: ValueEquality<T>): boolean {
  return left.length === right.length && left.every((value, index) => equal(value, right[index]!));
}

/** Reuse equal entries at the same position and preserve the whole previous array when possible. */
export function reconcileArray<T>(previous: T[], next: T[], equal: ValueEquality<T>): T[] {
  if (arraysEqual(previous, next, equal)) return previous;
  return next.map((value, index) => {
    if (index >= previous.length) return value;
    const prior = previous[index]!;
    return equal(prior, value) ? prior : value;
  });
}

/** Reuse equal entries by stable key and preserve the whole previous array when order and identity match. */
export function reconcileKeyedArray<T, TKey>(
  previous: T[],
  next: T[],
  keyFor: (value: T) => TKey,
  equal: ValueEquality<T>,
): T[] {
  const previousByKey = new Map(previous.map((value) => [keyFor(value), value]));
  const reconciled = next.map((value) => {
    const key = keyFor(value);
    if (!previousByKey.has(key)) return value;
    const prior = previousByKey.get(key)!;
    return equal(prior, value) ? prior : value;
  });
  return arraysEqual(previous, reconciled, (left, right) => left === right) ? previous : reconciled;
}

/** Reuse equal record values and preserve the whole previous record when keys and identities match. */
export function reconcileRecord<T>(
  previous: Record<string, T>,
  next: Record<string, T>,
  equal: ValueEquality<T>,
): Record<string, T> {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  let allSame = arraysEqual(previousKeys, nextKeys, (left, right) => left === right);
  const reconciled: Record<string, T> = {};
  for (const key of nextKeys) {
    const value = next[key]!;
    if (!Object.hasOwn(previous, key)) {
      reconciled[key] = value;
      allSame = false;
      continue;
    }
    const prior = previous[key]!;
    reconciled[key] = equal(prior, value) ? prior : value;
    if (reconciled[key] !== prior) allSame = false;
  }
  return allSame ? previous : reconciled;
}
