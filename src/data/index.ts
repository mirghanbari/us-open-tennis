// Typed accessors over the JSON the ingest pipeline writes. The data is
// imported at build time (static imports), so everything here is synchronous
// and cheap; live score patches come from ./live, which polls ESPN in the
// browser and overlays onto these records.

import matchesJson from "./matches.json";
import playersJson from "./players.json";
import drawsJson from "./draws.json";
import metaJson from "./meta.json";
import type { DrawMeta, EventCode, Match, MatchSide, Meta, Player, Tour } from "../types";

export const MATCHES = matchesJson as unknown as Match[];
export const PLAYERS = playersJson as unknown as Player[];
export const DRAWS = drawsJson as unknown as DrawMeta[];
export const META = metaJson as unknown as Meta;

const MATCH_BY_ID = new Map(MATCHES.map((m) => [m.id, m]));
const PLAYER_BY_ID = new Map(PLAYERS.map((p) => [p.id, p]));
const DRAW_BY_CODE = new Map(DRAWS.map((d) => [d.eventCode, d]));

export function getMatch(id: string): Match | undefined {
  return MATCH_BY_ID.get(id);
}

export function getPlayer(id: string): Player | undefined {
  return PLAYER_BY_ID.get(id);
}

export function getDraw(code: EventCode): DrawMeta | undefined {
  return DRAW_BY_CODE.get(code);
}

/** The events that actually have a published draw, in presentation order. */
export const EVENT_ORDER: EventCode[] = ["MS", "WS", "MD", "WD", "XD"];
export const publishedEvents = (): DrawMeta[] =>
  EVENT_ORDER.map((c) => DRAW_BY_CODE.get(c)).filter((d): d is DrawMeta => Boolean(d));

// ---------------------------------------------------------------------------
// Match helpers
// ---------------------------------------------------------------------------

/** Every player id taking part in a match, both sides. */
export function matchPlayerIds(m: Match): string[] {
  return m.sides.flatMap((s) => s.players.map((p) => p.id));
}

/** A side's display name — "Zverev" or "Zverev/Sonego" for a pair. */
export function sideName(side: MatchSide): string {
  if (side.players.length === 0) return "TBD";
  return side.players.map((p) => p.name).join(" / ");
}

/** True once both sides are known (an unplayed bracket slot has neither). */
export const isPlayable = (m: Match): boolean => m.sides.every((s) => s.players.length > 0);

export const isDecided = (m: Match): boolean =>
  m.status === "finished" || m.status === "retired" || m.status === "walkover";

/** Matches for a given event, in bracket order (round, then slot). */
export function matchesForEvent(code: EventCode): Match[] {
  return MATCHES.filter((m) => m.eventCode === code).sort(
    (a, b) => a.roundIndex - b.roundIndex || a.slot - b.slot
  );
}

/** Every match a player appears in, earliest round first. */
export function matchesForPlayer(playerId: string): Match[] {
  return MATCHES.filter((m) => matchPlayerIds(m).includes(playerId)).sort(
    (a, b) => a.roundIndex - b.roundIndex || a.slot - b.slot
  );
}

/** Which side (1 or 2) a player is on, or null if they aren't in the match. */
export function sideOf(m: Match, playerId: string): 1 | 2 | null {
  if (m.sides[0].players.some((p) => p.id === playerId)) return 1;
  if (m.sides[1].players.some((p) => p.id === playerId)) return 2;
  return null;
}

/** Matches scheduled on a given tournament day, grouped nowhere — just filtered. */
export function matchesOnDay(day: number): Match[] {
  return MATCHES.filter((m) => m.eventDay === day);
}

/** The tournament days that have any match attached, ascending. */
export function eventDays(): number[] {
  return [...new Set(MATCHES.map((m) => m.eventDay).filter((d): d is number => d != null))].sort(
    (a, b) => a - b
  );
}

/** Distinct court names currently in use, show courts first then numbered. */
export function courts(): string[] {
  const named = new Set(MATCHES.map((m) => m.court).filter((c): c is string => Boolean(c)));
  const SHOW = ["Arthur Ashe Stadium", "Louis Armstrong Stadium", "Grandstand", "Stadium 17"];
  const rest = [...named]
    .filter((c) => !SHOW.includes(c))
    .sort((a, b) => {
      const na = Number(a.replace(/\D/g, ""));
      const nb = Number(b.replace(/\D/g, ""));
      return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
    });
  return [...SHOW.filter((c) => named.has(c)), ...rest];
}

// ---------------------------------------------------------------------------
// Prize money
// ---------------------------------------------------------------------------

/**
 * What a player has earned so far in an event: the tier for the last round they
 * were beaten in, or the winner's tier if they took the title. The feed lists a
 * "W" tier above the final, so reaching round r and losing pays tier r.
 */
export function prizeMoneyFor(playerId: string, code: EventCode): number {
  const draw = DRAW_BY_CODE.get(code);
  if (!draw) return 0;
  const played = matchesForPlayer(playerId).filter((m) => m.eventCode === code && isDecided(m));
  if (played.length === 0) return 0;

  const last = played[played.length - 1];
  const wonLast = sideOf(last, playerId) === last.winner;
  // Champion: won the final, so take the "W" tier if the feed publishes one.
  if (wonLast && last.roundIndex === draw.totalRounds) {
    const w = draw.prizeMoney.find((p) => p.roundCode === "W");
    if (w) return w.amount;
  }
  // Otherwise they're paid for the round they exited in, which is the round of
  // their last match (won or lost — a win means the next match hasn't finished).
  const reached = wonLast ? Math.min(last.roundIndex + 1, draw.totalRounds) : last.roundIndex;
  const tier = draw.prizeMoney[reached - 1];
  return tier?.amount ?? 0;
}

// ---------------------------------------------------------------------------
// Standings-ish aggregates used across pages
// ---------------------------------------------------------------------------

export interface SeedStatus {
  player: Player;
  seed: number;
  out: boolean;
  /** The match that eliminated them, when they're out. */
  lostTo?: Match;
}

/** Seeded singles players and whether they've been knocked out. */
export function seedReport(code: EventCode): SeedStatus[] {
  const seeded = PLAYERS.filter((p) => p.seed != null).filter((p) =>
    matchesForPlayer(p.id).some((m) => m.eventCode === code)
  );
  return seeded
    .map((player) => {
      const played = matchesForPlayer(player.id).filter(
        (m) => m.eventCode === code && isDecided(m)
      );
      const lost = played.find((m) => sideOf(m, player.id) !== m.winner);
      return { player, seed: player.seed as number, out: Boolean(lost), lostTo: lost };
    })
    .sort((a, b) => a.seed - b.seed);
}

/** Completed matches the feed flagged as upsets, most recent round first. */
export function upsets(): Match[] {
  return MATCHES.filter((m) => m.upset && isDecided(m)).sort(
    (a, b) => (b.epoch ?? 0) - (a.epoch ?? 0)
  );
}

/** Longest completed matches by elapsed time, for the marathon tracker. */
export function longestMatches(limit = 10): Match[] {
  const mins = (d: string | null) => {
    if (!d) return 0;
    const [h, m] = d.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return MATCHES.filter((m) => isDecided(m) && m.duration)
    .sort((a, b) => mins(b.duration) - mins(a.duration))
    .slice(0, limit);
}

export const tourOf = (code: EventCode): Tour => (code === "WS" || code === "WD" ? "wta" : "atp");

export { useLiveMatches, applyLive } from "./live";
