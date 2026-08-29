import { useSyncExternalStore } from "react";

type HashLocationListener = () => void;

const listeners = new Set<HashLocationListener>();
let listening = false;

function emitHashLocationChange() {
  for (const listener of [...listeners]) listener();
}

function ensureHashLocationListener() {
  if (listening || typeof window === "undefined") return;
  window.addEventListener("hashchange", emitHashLocationChange);
  listening = true;
}

function releaseHashLocationListener() {
  if (!listening || listeners.size > 0 || typeof window === "undefined") return;
  window.removeEventListener("hashchange", emitHashLocationChange);
  listening = false;
}

export function subscribeHashLocation(listener: HashLocationListener): () => void {
  listeners.add(listener);
  ensureHashLocationListener();
  return () => {
    listeners.delete(listener);
    releaseHashLocationListener();
  };
}

export function getHashLocationSnapshot(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

export function useHashLocation(): string {
  return useSyncExternalStore(subscribeHashLocation, getHashLocationSnapshot, () => "");
}
