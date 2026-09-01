import { useState } from "react";
import { MATCHES, applyLive, eventDays, useLiveMatches } from "../data";
import { MatchCard } from "../components/MatchCard";
import { dateET } from "../format";

/**
 * Order of play, grouped by tournament day then court. The feed gives an
 * `eventDay` per match plus a start epoch for scheduled ones.
 */
export function Schedule() {
  const live = useLiveMatches();
  const matches = applyLive(MATCHES, live);
  const days = eventDays();

  // Default to the day with live play, else the latest day that has any match
  // with a known start time.
  const liveDay = matches.find((m) => m.status === "live")?.eventDay;
  const [day, setDay] = useState<number>(liveDay ?? days[days.length - 1] ?? 1);

  const onDay = matches
    .filter((m) => m.eventDay === day)
    .sort((a, b) => (a.startEpoch ?? a.epoch ?? 0) - (b.startEpoch ?? b.epoch ?? 0));

  const sample = onDay.find((m) => m.startEpoch ?? m.epoch);

  return (
    <>
      <div className="page-head">
        <h1>Order of play</h1>
        <p>
          {sample ? dateET(sample.startEpoch ?? sample.epoch) : `Day ${day}`} · {onDay.length} matches scheduled. All
          times New York.
        </p>
      </div>

      <div className="filters">
        {days.map((d) => (
          <button
            key={d}
            className={"chip" + (d === day ? " is-on" : "")}
            onClick={() => setDay(d)}
          >
            Day {d}
          </button>
        ))}
      </div>

      {onDay.length === 0 ? (
        <div className="empty">Nothing scheduled for this day yet.</div>
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
