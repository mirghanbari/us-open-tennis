// Shared display helpers. Everything time-related is rendered in New York time —
// the tournament's own clock — regardless of where the viewer is, so an "order
// of play" reads the same as it does on site.

import type { Match, MatchSide } from "./types";

export const NY = "America/New_York";

export function timeET(epoch: number | null): string {
  if (!epoch) return "";
  return new Date(epoch).toLocaleTimeString("en-US", {
    timeZone: NY,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dateET(epoch: number | null): string {
  if (!epoch) return "";
  return new Date(epoch).toLocaleDateString("en-US", {
    timeZone: NY,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "1:23" → "1h 23m". The feed ships elapsed time as H:MM. */
export function duration(d: string | null): string {
  if (!d) return "";
  const [h, m] = d.split(":");
  return Number(h) > 0 ? `${Number(h)}h ${m}m` : `${Number(m)}m`;
}

export const money = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`
    : `$${Math.round(n / 1000)}K`;

/** Seed / entry-status suffix, e.g. "(1)" or "(Q)". */
export function sideTag(side: MatchSide): string {
  if (side.seed != null) return `(${side.seed})`;
  if (side.entryStatus) return `(${side.entryStatus})`;
  return "";
}

/** Short round label for chips and bracket columns. */
export function roundLabel(m: Match): string {
  const n = m.roundName || "";
  return (
    n
      .replace("Quarter-Finals", "QF")
      .replace("Semi-Finals", "SF")
      .replace("Round ", "R") || `R${m.roundIndex}`
  );
}

export const isLive = (m: Match) => m.status === "live";

/**
 * Which side leads the current (unfinished) set — used to show who is ahead
 * while a match is in progress.
 */
export function currentSetLeader(m: Match): 1 | 2 | null {
  const s = m.sets[m.sets.length - 1];
  if (!s) return null;
  if (s.games[0] > s.games[1]) return 1;
  if (s.games[1] > s.games[0]) return 2;
  return null;
}

/** Sets won by each side, counting only completed sets. */
export function setsWon(m: Match): [number, number] {
  let a = 0;
  let b = 0;
  for (const s of m.sets) {
    const [x, y] = s.games;
    // A set is done at 6+ with a 2-game margin, or a 7-6 tiebreak.
    const done = (Math.max(x, y) >= 6 && Math.abs(x - y) >= 2) || Math.max(x, y) === 7;
    if (!done) continue;
    if (x > y) a++;
    else if (y > x) b++;
  }
  return [a, b];
}
