// Typed accessors over the JSON the ingest pipeline writes. The data is
// imported at build time (static imports), so everything here is synchronous
// and cheap; live score patches come from ./live, which polls ESPN in the
// browser and overlays onto these records.

import matchesJson from "./matches.json";
import playersJson from "./players.json";
import drawsJson from "./draws.json";
import metaJson from "./meta.json";
import h2hJson from "./headtohead.json";
import statsJson from "./stats.json";
import type {
  DrawMeta,
  EventCode,
  HeadToHead,
  Match,
  MatchStats,
  MatchSide,
  Meta,
  Player,
  Tour,
} from "../types";

export const MATCHES = matchesJson as unknown as Match[];
export const PLAYERS = playersJson as unknown as Player[];
export const DRAWS = drawsJson as unknown as DrawMeta[];
export const META = metaJson as unknown as Meta;
export const HEAD_TO_HEAD = h2hJson as unknown as Record<string, HeadToHead>;
export const MATCH_STATS = statsJson as unknown as Record<string, MatchStats>;

/** Serve statistics for a match, when Tennismylife has published them yet. */
export function matchStats(matchId: string): MatchStats | undefined {
  return MATCH_STATS[matchId];
}

/** Head-to-head for a match, when the feed published one (upcoming matches only). */
export function headToHead(matchId: string): HeadToHead | undefined {
  return HEAD_TO_HEAD[matchId];
}

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

// Built once. The leaderboards ask for many players' matches at a time, and
// re-scanning all 332 matches per player made that quadratic.
const MATCHES_BY_PLAYER = (() => {
  const idx = new Map<string, Match[]>();
  for (const m of MATCHES) {
    for (const id of matchPlayerIds(m)) {
      if (!idx.has(id)) idx.set(id, []);
      idx.get(id)!.push(m);
    }
  }
  for (const list of idx.values()) {
    list.sort((a, b) => a.roundIndex - b.roundIndex || a.slot - b.slot);
  }
  return idx;
})();

/** Every match a player appears in, earliest round first. */
export function matchesForPlayer(playerId: string): Match[] {
  return MATCHES_BY_PLAYER.get(playerId) ?? [];
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

export interface PlayDay {
  /** The feed's own day number. Kept as the grouping key, not for display. */
  eventDay: number;
  /** "2026-08-31" in New York time — the date this session actually falls on. */
  date: string;
  /** "Mon, Aug 31" */
  label: string;
}

const nyDate = (epoch: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(epoch));

/**
 * The tournament's play days, each labelled with its real calendar date.
 *
 * The feed's `eventDay` counts from the start of Fan Week — its day 9 is the
 * main draw's opening day — so showing that number raw reads as wrong to anyone
 * following the tournament. We keep `eventDay` as the grouping key (it is the
 * feed's own session grouping and correctly separates a late finish from the
 * next day's play) but label by date instead of inventing a rival numbering.
 *
 * The date is the MODE of the day's start times, not the min: a match running
 * past midnight ET would otherwise drag a whole day's label onto the next date.
 */
export function playDays(): PlayDay[] {
  const byDay = new Map<number, Map<string, number>>();
  for (const m of MATCHES) {
    if (m.eventDay == null) continue;
    if (!byDay.has(m.eventDay)) byDay.set(m.eventDay, new Map());
    const stamp = m.startEpoch ?? m.epoch;
    if (!stamp) continue;
    const counts = byDay.get(m.eventDay)!;
    const key = nyDate(stamp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const days: PlayDay[] = [];
  for (const [eventDay, counts] of byDay) {
    const date = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!date) continue;
    // Parse as midday UTC so the date can't shift when formatted back to ET.
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    days.push({ eventDay, date, label });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
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

export interface Earnings {
  player: Player;
  amount: number;
  events: EventCode[];
}

/** Players ranked by guaranteed prize money so far, across every event. */
export function prizeMoneyLeaders(limit = 25): Earnings[] {
  const rows: Earnings[] = [];
  for (const player of PLAYERS) {
    const events = [...new Set(matchesForPlayer(player.id).map((m) => m.eventCode))];
    const amount = events.reduce((sum, e) => sum + prizeMoneyFor(player.id, e), 0);
    if (amount > 0) rows.push({ player, amount, events });
  }
  return rows.sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** Win–loss record here, for a player. */
export function recordFor(playerId: string): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const m of matchesForPlayer(playerId)) {
    if (!isDecided(m)) continue;
    if (sideOf(m, playerId) === m.winner) wins++;
    else losses++;
  }
  return { wins, losses };
}

/** Nations ranked by how many players they still have alive in singles. */
export function nationsRemaining(): { nation: string; alive: number; total: number }[] {
  const tally = new Map<string, { alive: number; total: number }>();
  for (const p of PLAYERS) {
    const singles = matchesForPlayer(p.id).filter(
      (m) => m.eventCode === "MS" || m.eventCode === "WS"
    );
    if (singles.length === 0) continue;
    const row = tally.get(p.nation) ?? { alive: 0, total: 0 };
    row.total++;
    // Alive = never lost a completed singles match here.
    const lost = singles.some((m) => isDecided(m) && sideOf(m, p.id) !== m.winner);
    if (!lost) row.alive++;
    tally.set(p.nation, row);
  }
  return [...tally.entries()]
    .map(([nation, v]) => ({ nation, ...v }))
    .sort((a, b) => b.alive - a.alive || b.total - a.total);
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

// ---------------------------------------------------------------------------
// Serve leaderboards (Tennismylife)
// ---------------------------------------------------------------------------

export interface ServeTotals {
  player: Player;
  matches: number;
  aces: number;
  doubleFaults: number;
  servePoints: number;
  firstIn: number;
  firstWon: number;
  secondWon: number;
  bpSaved: number;
  bpFaced: number;
  acesPerMatch: number;
  firstServePct: number | null;
  firstWonPct: number | null;
  secondWonPct: number | null;
  bpSavedPct: number | null;
}

/**
 * Per-player serve totals across every match Tennismylife has published stats
 * for. Rates are computed from the summed counts, not by averaging per-match
 * percentages — a 3-set and a 5-set match should not carry equal weight.
 */
export function serveTotals(): ServeTotals[] {
  const acc = new Map<string, ServeTotals>();

  for (const [matchId, stats] of Object.entries(MATCH_STATS)) {
    const m = MATCH_BY_ID.get(matchId);
    if (!m) continue;
    m.sides.forEach((side, i) => {
      const player = side.players[0] ? PLAYER_BY_ID.get(side.players[0].id) : undefined;
      const s = stats.sides[i];
      if (!player || !s) return;
      let row = acc.get(player.id);
      if (!row) {
        row = {
          player,
          matches: 0,
          aces: 0,
          doubleFaults: 0,
          servePoints: 0,
          firstIn: 0,
          firstWon: 0,
          secondWon: 0,
          bpSaved: 0,
          bpFaced: 0,
          acesPerMatch: 0,
          firstServePct: null,
          firstWonPct: null,
          secondWonPct: null,
          bpSavedPct: null,
        };
        acc.set(player.id, row);
      }
      row.matches++;
      row.aces += s.aces ?? 0;
      row.doubleFaults += s.doubleFaults ?? 0;
      row.servePoints += s.servePoints ?? 0;
      row.firstIn += s.firstIn ?? 0;
      row.firstWon += s.firstWon ?? 0;
      row.secondWon += s.secondWon ?? 0;
      row.bpSaved += s.bpSaved ?? 0;
      row.bpFaced += s.bpFaced ?? 0;
    });
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
  for (const row of acc.values()) {
    row.acesPerMatch = row.matches ? row.aces / row.matches : 0;
    row.firstServePct = pct(row.firstIn, row.servePoints);
    row.firstWonPct = pct(row.firstWon, row.firstIn);
    row.secondWonPct = pct(row.secondWon, row.servePoints - row.firstIn);
    row.bpSavedPct = pct(row.bpSaved, row.bpFaced);
  }
  return [...acc.values()];
}
