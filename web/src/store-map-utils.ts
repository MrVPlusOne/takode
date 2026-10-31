export function withMapEntry<K, V>(source: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(source);
  next.set(key, value);
  return next;
}

export function withOptionalMapEntry<K, V>(source: ReadonlyMap<K, V>, key: K, value: V | null): Map<K, V> {
  const next = new Map(source);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}
