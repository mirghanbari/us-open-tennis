import { Link } from "react-router-dom";
import type { Match } from "../types";
import { isDecided, sideName } from "../data";
import { duration, roundLabel, sideTag, timeET } from "../format";

/** The set-score column for one side of a match. */
function Sets({ m, side }: { m: Match; side: 0 | 1 }) {
  if (m.sets.length === 0) return null;
  return (
    <div className="sets">
      {m.sets.map((s, i) => {
        const mine = s.games[side];
        const theirs = s.games[side === 0 ? 1 : 0];
        return (
          <span key={i} className={"set " + (mine > theirs ? "is-won" : "is-lost")}>
            {mine}
            {s.tiebreak ? <sup>{s.tiebreak[side]}</sup> : null}
          </span>
        );
      })}
    </div>
  );
}

export function MatchCard({ m, hideCourt = false }: { m: Match; hideCourt?: boolean }) {
  const decided = isDecided(m);
  const live = m.status === "live";

  return (
    <Link to={`/matches/${m.id}`} className="match">
      <div className="match-top">
        {live && (
          <span className="badge badge-live">
            <span className="dot-live" /> LIVE
          </span>
        )}
        <span>{m.eventName}</span>
        <span>·</span>
        <span>{roundLabel(m)}</span>
        {/* Court and time each carry their own leading separator so that when
            the row wraps, the "·" travels with the text it belongs to instead
            of being left dangling at the end of the previous line. */}
        {m.court && !hideCourt && <span>· {m.court}</span>}
        {!decided && !live && m.startEpoch && <span>· {timeET(m.startEpoch)} ET</span>}
        {m.upset && <span className="badge badge-upset">Upset</span>}
        {m.status === "retired" && <span className="badge">Retired</span>}
        <span style={{ marginLeft: "auto" }} className="row">
          {m.broadcasts?.map((b) => (
            <span key={b.name} className="badge badge-tv">
              {b.name}
            </span>
          ))}
          {decided && m.duration && <span className="tiny faint">{duration(m.duration)}</span>}
        </span>
      </div>

      {m.sides.map((side, i) => {
        const won = m.winner === i + 1;
        const lost = m.winner != null && !won;
        return (
          <div
            key={i}
            className={"match-side" + (won ? " is-winner" : "") + (lost ? " is-loser" : "")}
          >
            <div className="match-name">
              <span className="flag">{side.players[0]?.nation ?? ""}</span>
              <span className="nm">{sideName(side)}</span>
              {sideTag(side) && <span className="tiny faint">{sideTag(side)}</span>}
            </div>
            <Sets m={m} side={i as 0 | 1} />
          </div>
        );
      })}
    </Link>
  );
}
