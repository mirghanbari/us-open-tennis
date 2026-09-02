import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  MATCHES,
  applyLive,
  getMatch,
  officialDay,
  playDays,
  publishedEvents,
  useLiveMatches,
} from "../data";
import { MatchCard } from "../components/MatchCard";
import type { EventCode } from "../types";

/**
 * Order of play, one tournament session at a time. Days are grouped by the
 * feed's `eventDay` but labelled with their real date — the feed counts from
 * Fan Week (its day 9 is the main draw's opening day), so surfacing its day
 * numbers reads as wrong to anyone following the tournament.
 */
export function Schedule() {
  const live = useLiveMatches();
  const matches = applyLive(MATCHES, live);
  const events = publishedEvents();

  // Day chips come from the draw (which covers every day, including past ones),
  // but the label prefers the tournament's own — "Day 4: Wednesday, September 2"
  // — wherever the order-of-play feed publishes it.
  const days = playDays().map((d) => {
    const official = officialDay(d.eventDay);
    return {
      ...d,
      label: official?.shortLabel ?? official?.label ?? d.label,
      hasOrderOfPlay: Boolean(official),
    };
  });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date()
  );

  // Default to the session with live play; failing that today; failing that the
  // most recent day that has any play at all.
  const liveDay = matches.find((m) => m.status === "live")?.eventDay;
  const initial =
    liveDay ??
    days.find((d) => d.date === today)?.eventDay ??
    days[days.length - 1]?.eventDay ??
    0;

  const [day, setDay] = useState<number>(initial);
  const [event, setEvent] = useState<EventCode | "all">("all");

  // The official feed only assigns a day and court about 24 hours ahead, so
  // every round beyond the next has no session at all. Rather than hide those
  // matches entirely, collect the ones whose players are already known into an
  // "upcoming" bucket, keyed by this sentinel.
  const UNSCHEDULED = -1;
  const isUpcoming = (m: (typeof matches)[number]) =>
    m.eventDay == null && m.winner == null && m.sides.every((s) => s.players.length > 0);
  const upcomingCount = matches.filter(isUpcoming).length;

  const inBucket = (m: (typeof matches)[number]) =>
    day === UNSCHEDULED ? isUpcoming(m) : m.eventDay === day;

  const onDay = useMemo(
    () =>
      matches
        .filter(inBucket)
        .filter((m) => (event === "all" ? true : m.eventCode === event))
        .sort(
          (a, b) =>
            a.roundIndex - b.roundIndex ||
            (a.startEpoch ?? a.epoch ?? 0) - (b.startEpoch ?? b.epoch ?? 0) ||
            a.slot - b.slot
        ),
    [matches, day, event]
  );

  const current = days.find((d) => d.eventDay === day);

  // Only offer event filters that actually have a match in the selected bucket.
  const eventsToday = new Set(matches.filter(inBucket).map((m) => m.eventCode));

  return (
    <>
      <div className="page-head">
        <h1>Order of play</h1>
        <p>
          {day === UNSCHEDULED ? (
            <>
              {onDay.length} {onDay.length === 1 ? "match" : "matches"} with both players known
              but no session announced yet — the tournament publishes the order of play about a
              day ahead.
            </>
          ) : (
            <>
              {current?.label ?? "Schedule"} · {onDay.length}{" "}
              {onDay.length === 1 ? "match" : "matches"}. All times New York.
            </>
          )}
        </p>
      </div>

      <div className="filters">
        {days.map((d) => (
          <button
            key={d.eventDay}
            className={"chip" + (d.eventDay === day ? " is-on" : "")}
            onClick={() => setDay(d.eventDay)}
          >
            {d.label}
            {d.date === today ? " · today" : ""}
          </button>
        ))}
        {upcomingCount > 0 && (
          <button
            className={"chip" + (day === UNSCHEDULED ? " is-on" : "")}
            onClick={() => setDay(UNSCHEDULED)}
          >
            Upcoming · {upcomingCount}
          </button>
        )}
      </div>

      <div className="filters">
        <button
          className={"chip" + (event === "all" ? " is-on" : "")}
          onClick={() => setEvent("all")}
        >
          All events
        </button>
        {events
          .filter((e) => eventsToday.has(e.eventCode))
          .map((e) => (
            <button
              key={e.eventCode}
              className={"chip" + (event === e.eventCode ? " is-on" : "")}
              onClick={() => setEvent(e.eventCode)}
            >
              {e.eventName}
            </button>
          ))}
      </div>

      {day !== UNSCHEDULED && officialDay(day) ? (
        <OrderOfPlay day={day} event={event} matches={matches} />
      ) : onDay.length === 0 ? (
        <div className="empty">Nothing scheduled for this session yet.</div>
      ) : day === UNSCHEDULED ? (
        // Grouped by round, since there is no time order to sort by.
        [...new Set(onDay.map((m) => `${m.eventCode}|${m.roundName}`))].map((key) => {
          const group = onDay.filter((m) => `${m.eventCode}|${m.roundName}` === key);
          return (
            <div key={key}>
              <div className="section-head">
                <h2>
                  {group[0].eventName} · {group[0].roundName}
                </h2>
                <span className="tiny faint">{group.length} matches</span>
              </div>
              <div className="grid grid-2">
                {group.map((m) => (
                  <MatchCard key={m.id} m={m} />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <div className="grid grid-2">
          {onDay.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The official order of play: each court's programme in the order matches will
 * actually be played, which is what the tournament publishes and what spectators
 * read. Nominal start times only apply to the first match on each court; after
 * that it is "2nd on" and, sometimes, a "not before" guarantee.
 */
function OrderOfPlay({
  day,
  event,
  matches,
}: {
  day: number;
  event: EventCode | "all";
  matches: ReturnType<typeof applyLive>;
}) {
  const official = officialDay(day);
  if (!official) return null;
  const byId = new Map(matches.map((m) => [m.id, m]));

  const courts = official.courts
    .map((c) => ({
      ...c,
      matches: c.matches.filter((m) => (event === "all" ? true : m.eventCode === event)),
    }))
    .filter((c) => c.matches.length > 0);

  return (
    <>
      {courts.map((c) => (
        <div key={`${c.court}-${c.session ?? 1}`} className="op-court">
          <div className="op-head">
            <span>
              {c.court}
              {c.session === 2 && <span className="op-time"> · night session</span>}
            </span>
            <span className="op-time">{c.startTime ? `from ${c.startTime}` : ""}</span>
          </div>
          <div className="op-list">
            {c.matches.map((sm) => {
              const m = byId.get(sm.id) ?? getMatch(sm.id);
              return (
                <Link key={sm.id} to={`/matches/${sm.id}`} className="op-row">
                  <span className="op-order">{sm.order ?? "—"}</span>
                  <span>
                    {/* An unfilled slot has no round or event yet, which would
                        otherwise render as a lone separator. */}
                    {(sm.roundName || sm.notBefore) && (
                      <>
                        <span className="tiny faint">
                          {[sm.roundName, sm.eventCode].filter(Boolean).join(" · ")}
                          {sm.notBefore
                            ? `${sm.roundName ? " · " : ""}not before ${sm.notBefore}`
                            : ""}
                        </span>
                        <br />
                      </>
                    )}
                    {sm.team1 || sm.team2 ? (
                      <>
                        <strong>{sm.team1 || "TBD"}</strong>{" "}
                        <span className="faint">v</span>{" "}
                        <strong>{sm.team2 || "TBD"}</strong>
                      </>
                    ) : (
                      <span className="faint">Winner of an earlier match</span>
                    )}
                  </span>
                  <span className="row" style={{ justifyContent: "flex-end" }}>
                    {sm.status === "live" && (
                      <span className="badge badge-live">
                        <span className="dot-live" /> LIVE
                      </span>
                    )}
                    {sm.status === "suspended" && (
                      <span className="badge badge-suspended">Suspended</span>
                    )}
                    {m && m.sets.length > 0 && (
                      <span className="mono tiny">
                        {m.sets.map((x) => `${x.games[0]}-${x.games[1]}`).join(" ")}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
