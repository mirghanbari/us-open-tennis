import { useSyncExternalStore } from "react";

// The players a visitor has starred. Device-local only (no account, no sync) —
// ported from the World Cup dashboard's team-favourites store and retargeted to
// players. A tiny external store backs useSyncExternalStore so a star toggled
// anywhere (a Players row, a player page) instantly updates every other view.

const KEY = "uso-favorites";
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Private window, blocked storage, or corrupt JSON — behave as "no favourites"
    // rather than taking the page down.
    return [];
  }
}

// getSnapshot must return a stable reference between changes, so cache the
// parsed array and only replace it when the store actually changes.
let cache: string[] = read();

function emit() {
  cache = read();
  listeners.forEach((l) => l());
}

// Keep tabs in sync — storage events fire only in *other* documents.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) emit();
  });
}

export function isFavorite(id: string): boolean {
  return cache.includes(id);
}

export function toggleFavorite(id: string): void {
  const next = cache.includes(id) ? cache.filter((x) => x !== id) : [...cache, id];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the toggle just won't persist across reloads */
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive list of starred player ids, in the order they were added. */
export function useFavorites(): string[] {
  return useSyncExternalStore(subscribe, () => cache, () => cache);
}
