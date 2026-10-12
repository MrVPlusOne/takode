import { useMemo, useRef } from "react";

// biome-ignore lint/suspicious/noExplicitAny: callbacks keep their own parameter types through T.
type CallbackMap = Record<string, (...args: any[]) => unknown>;

/**
 * Return callbacks with stable identities that always call the latest versions passed in.
 *
 * Use it for handlers handed to many memoized children, so a parent re-render does not
 * re-render every child just because its handlers were recreated. The set of keys must
 * not change between renders.
 */
export function useStableCallbacks<T extends CallbackMap>(callbacks: T): T {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the wrappers read the latest callbacks through the ref.
  return useMemo(
    () =>
      Object.fromEntries(
        Object.keys(callbacks).map((key) => [key, (...args: unknown[]) => latest.current[key]!(...args)]),
      ) as T,
    [],
  );
}
