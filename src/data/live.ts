// Live-score polling, straight from the browser to ESPN.
//
// The World Cup dashboard polled a slim `live.json` that a GitHub Action
// regenerated and redeployed. That works for four matches a day; the US Open
// plays up to 17 courts for 12+ hours, so that loop would run essentially
// nonstop and still lag by a deploy cycle.
//
// Instead the client fetches ESPN's scoreboard directly. ESPN sends
// `access-control-allow-origin: *` with `cache-control: max-age=9`, and the
// whole 5-draw payload is ~99KB gzipped — so this is both faster (~10s fresh
// vs ~2min) and cheaper (no Actions minutes, no redeploy) than the alternative.
//
// The committed matches.json remains the fallback: if ESPN is unreachable the
// page still renders the last ingested state rather than going blank.
import { useEffect, useRef, useState } from "react";
import { MATCHES } from ".";
import type { Match, MatchStatus, SetScore } from "../types";

// ESPN's atp and wta scoreboards return IDENTICAL payloads for a Slam (all five
// draws under both), so one request covers everything.
const ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard";

const POLL_MS = 30_000; // while play is under way
const IDLE_MS = 10 * 60_000; // overnight heartbeat, to catch the next day's start

/** What a poll can tell us about a match, keyed by ESPN competition id. */
export interface LivePatch {
  status: MatchStatus;
  sets: SetScore[];
  winner: 1 | 2 | null;
  court: string | null;
  /** ESPN competitor ids in ESPN's own order, so we can align to our sides. */
  competitorIds: [string, string];
}

/**
 * Play runs roughly 11:00–01:00 New York time. Outside that window there is
 * nothing to poll for, so drop to a slow heartbeat rather than hammering ESPN
 * through the night. Computed in the America/New_York zone regardless of where
 * the viewer is.
 */
function playWindowNow(now = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(now)
  );
  // 11:00 through 01:59 the next morning.
  return hour >= 11 || hour <= 1;
}

/** Is the tournament still running, per the committed metadata? */
function withinTournament(now = new Date()): boolean {
  const days = MATCHES.map((m) => m.epoch).filter((e): e is number => e != null);
  if (days.length === 0) return true;
  const last = Math.max(...days);
  // Give the final day a generous tail so a late finish still updates.
  return now.getTime() <= last + 12 * 60 * 60_000;
}

function toStatus(state: string | undefined, completed: boolean | undefined): MatchStatus {
  if (state === "in") return "live";
  if (state === "post" || completed) return "finished";
  return "scheduled";
}

/** ESPN linescores → our per-set shape, for one competitor pair. */
function toSets(a: any[], b: any[]): SetScore[] {
  const n = Math.max(a?.length ?? 0, b?.length ?? 0);
  const out: SetScore[] = [];
  for (let i = 0; i < n; i++) {
    const x = a?.[i];
    const y = b?.[i];
    out.push({
      games: [x?.value ?? 0, y?.value ?? 0],
      tiebreak:
        x?.tiebreak != null || y?.tiebreak != null ? [x?.tiebreak ?? 0, y?.tiebreak ?? 0] : null,
    });
  }
  return out;
}

async function fetchLive(): Promise<Map<string, LivePatch>> {
  const out = new Map<string, LivePatch>();
  const res = await fetch(ESPN_URL, { cache: "no-store" });
  if (!res.ok) return out;
  const data: any = await res.json();
  const event = data?.events?.[0];
  for (const grouping of event?.groupings ?? []) {
    for (const comp of grouping.competitions ?? []) {
      const cs = comp.competitors ?? [];
      if (cs.length !== 2) continue;
      const state = comp.status?.type?.state;
      out.set(String(comp.id), {
        status: toStatus(state, comp.status?.type?.completed),
        sets: toSets(cs[0].linescores, cs[1].linescores),
        winner: cs[0].winner === true ? 1 : cs[1].winner === true ? 2 : null,
        court: comp.venue?.court ?? null,
        competitorIds: [String(cs[0].id), String(cs[1].id)],
      });
    }
  }
  return out;
}

/**
 * Live patches keyed by ESPN competition id. Empty until the first poll lands,
 * and left untouched (rather than cleared) if a poll fails.
 */
export function useLiveMatches(): Map<string, LivePatch> {
  const [live, setLive] = useState<Map<string, LivePatch>>(() => new Map());
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const next = await fetchLive();
        if (!cancelled && next.size > 0) setLive(next);
      } catch {
        /* offline or ESPN hiccup — keep the last good data, retry next tick */
      }
    }

    function schedule() {
      if (cancelled) return;
      const active = playWindowNow() && withinTournament();
      timer = setTimeout(
        async () => {
          // Never poll a backgrounded tab; refresh happens on refocus instead.
          if (!document.hidden && playWindowNow() && withinTournament()) await poll();
          schedule();
        },
        active ? POLL_MS : IDLE_MS
      );
    }

    if (playWindowNow() && withinTournament()) poll();
    schedule();

    const onVisible = () => {
      if (!document.hidden && playWindowNow() && withinTournament()) poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return live;
}

/**
 * Overlay live patches onto the bundled matches. Returns the same array when
 * nothing has changed, so consumers can rely on referential equality.
 *
 * Side alignment uses the `espnSideIds` the ingest resolved: ESPN's competitor
 * order does not track the draw's team1/team2, so scores are mapped by id, not
 * position. A match without that mapping is left exactly as ingested.
 */
export function applyLive(matches: Match[], live: Map<string, LivePatch>): Match[] {
  if (live.size === 0) return matches;
  let changed = false;
  const next = matches.map((m) => {
    if (!m.espnId || !m.espnSideIds) return m;
    const patch = live.get(m.espnId);
    if (!patch) return m;

    // Map ESPN's competitor order onto ours.
    const flip = patch.competitorIds[0] !== m.espnSideIds[0];
    const sets = flip
      ? patch.sets.map((s) => ({
          games: [s.games[1], s.games[0]] as [number, number],
          tiebreak: s.tiebreak ? ([s.tiebreak[1], s.tiebreak[0]] as [number, number]) : null,
        }))
      : patch.sets;
    const winner = patch.winner == null ? null : flip ? ((3 - patch.winner) as 1 | 2) : patch.winner;

    // The official feed is authoritative for a decided match — it carries
    // retirements and walkovers, which ESPN flattens to a plain "final". Only
    // let the live feed advance a match that isn't settled in our data yet.
    if (m.status === "retired" || m.status === "walkover" || m.status === "finished") return m;
    if (patch.status === "scheduled" && sets.length === 0) return m;

    changed = true;
    return {
      ...m,
      status: patch.status,
      sets: sets.length ? sets : m.sets,
      winner: winner ?? m.winner,
      court: patch.court ?? m.court,
    };
  });
  return changed ? next : matches;
}
