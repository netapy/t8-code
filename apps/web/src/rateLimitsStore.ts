import { useSyncExternalStore } from "react";
import type { RateLimitsPayload } from "./wsNativeApi";

let snapshot: RateLimitsPayload | null = null;
let listeners: Array<() => void> = [];

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function pushRateLimitsUpdate(payload: RateLimitsPayload): void {
  snapshot = payload;
  emitChange();
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

function getSnapshot(): RateLimitsPayload | null {
  return snapshot;
}

export function useRateLimits(): RateLimitsPayload | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
