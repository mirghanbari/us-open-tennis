// Browser notifications when a starred player goes on court.
//
// Deliberately simple and honest about its limits: there is no service worker
// and no push subscription, so this only fires while a tab is open. Making it
// work with the tab closed would need a push service and a server to talk to
// it, which this project doesn't have.
import { useEffect, useRef } from "react";
import { useSyncExternalStore } from "react";
import type { Match } from "./types";
import { matchPlayerIds, sideName } from "./data";

const ENABLED_KEY = "uso-notify";
const SEEN_KEY = "uso-notified";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}
let enabledCache = typeof window === "undefined" ? false : readEnabled();

/** Match ids we've already announced, so a re-render or reload can't repeat one. */
function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function markSeen(id: string) {
  try {
    const seen = readSeen();
    seen.add(id);
    // Keep it bounded — a fortnight of matches is a few hundred ids at most.
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  } catch {
    /* storage unavailable — we may re-notify after a reload, which is harmless */
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export function useNotificationsEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => enabledCache,
    () => false
  );
}

/**
 * Turn notifications on (asking permission if needed) or off. Must be called
 * from a user gesture — browsers reject a permission prompt otherwise.
 */
export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  if (!on) {
    try {
      localStorage.setItem(ENABLED_KEY, "0");
    } catch {
      /* ignore */
    }
    enabledCache = false;
    emit();
    return false;
  }
  if (!notificationsSupported()) return false;
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  const granted = permission === "granted";
  try {
    localStorage.setItem(ENABLED_KEY, granted ? "1" : "0");
  } catch {
    /* ignore */
  }
  enabledCache = granted;
  emit();
  return granted;
}

/**
 * Fire a notification the first time a starred player's match goes live.
 *
 * Runs off the same live-patched match array the pages render, so it needs no
 * polling of its own. Only transitions are announced: a match already live when
 * the page loads is recorded as seen without firing, otherwise every reload
 * during a long match would notify again.
 */
export function useOnCourtNotifications(matches: Match[], favorites: string[]) {
  const primed = useRef(false);

  useEffect(() => {
    if (!enabledCache || !notificationsSupported() || Notification.permission !== "granted") {
      return;
    }
    if (favorites.length === 0) return;

    const live = matches.filter(
      (m) => m.status === "live" && matchPlayerIds(m).some((id) => favorites.includes(id))
    );

    // First pass after mount: record what is already on court without firing,
    // so opening the page mid-match is silent.
    if (!primed.current) {
      primed.current = true;
      live.forEach((m) => markSeen(m.id));
      return;
    }

    const seen = readSeen();
    for (const m of live) {
      if (seen.has(m.id)) continue;
      markSeen(m.id);
      try {
        const n = new Notification("On court now", {
          body: `${m.sides.map((s) => sideName(s)).join(" v ")}\n${m.eventName} · ${m.roundName}${
            m.court ? ` · ${m.court}` : ""
          }`,
          tag: m.id,
          icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8E%BE%3C/text%3E%3C/svg%3E",
        });
        n.onclick = () => {
          window.focus();
          window.location.hash = `#/matches/${m.id}`;
          n.close();
        };
      } catch {
        /* some browsers throw when constructing notifications in odd states */
      }
    }
  }, [matches, favorites]);
}
