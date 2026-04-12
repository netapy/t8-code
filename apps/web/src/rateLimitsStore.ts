import { useSyncExternalStore } from "react";

export interface RateLimitWindow {
  windowDurationMins?: number;
  resetsAt?: number;
  usedPercent?: number;
}

export interface RateLimitsPayload {
  rateLimits?: {
    primary?: RateLimitWindow | null;
    secondary?: RateLimitWindow | null;
  };
}

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
