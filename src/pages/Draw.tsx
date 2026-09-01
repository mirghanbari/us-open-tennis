import { Link, useParams } from "react-router-dom";
import {
  MATCHES,
  applyLive,
  getDraw,
  publishedEvents,
  sideName,
  useLiveMatches,
} from "../data";
import type { EventCode, Match } from "../types";
import { sideTag } from "../format";

/** Column headings by round index, given how many rounds the draw has. */
function roundName(index: number, totalRounds: number): string {
  const fromEnd = totalRounds - index;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi-finals";
  if (fromEnd === 2) return "Quarter-finals";
  return `Round ${index}`;
}

function BracketMatch({ m }: { m: Match }) {
  return (
    <Link
      to={`/matches/${m.id}`}
      className={"bracket-match" + (m.status === "live" ? " is-live" : "")}
    >
      {m.sides.map((side, i) => {
        const won = m.winner === i + 1;
        const lost = m.winner != null && !won;
        const games = m.sets.map((s) => s.games[i]).join(" ");
        return (
          <div
            key={i}
            className={"bracket-side" + (won ? " is-winner" : "") + (lost ? " is-loser" : "")}
          >
            <span className={side.players.length ? "nm" : "bracket-tbd"}>
              {side.seed != null && <span className="faint">{side.seed} </span>}
              {sideName(side)}
              {side.entryStatus && !side.seed && (
                <span className="faint"> {sideTag(side)}</span>
              )}
            </span>
            <span className="mono faint">{games}</span>
          </div>
        );
      })}
    </Link>
  );
}

/**
 * The full bracket. The tree comes straight from the feed's `match_id` scheme
 * (see ingest-usopen.mjs) — round r slot n advances into round r+1 slot
 * ceil(n/2) — so no inference is needed and the columns always line up.
 */
export function Draw() {
  const params = useParams<{ event: string }>();
  const events = publishedEvents();
  const code = (params.event?.toUpperCase() as EventCode) ?? events[0]?.eventCode ?? "MS";
  const draw = getDraw(code);

  const live = useLiveMatches();
  const matches = applyLive(MATCHES, live).filter((m) => m.eventCode === code);

  if (!draw) {
    return (
      <div className="empty">
        That draw has not been published yet.
        <div style={{ marginTop: 12 }}>
          {events.map((e) => (
            <Link key={e.eventCode} to={`/draw/${e.eventCode}`} className="chip">
              {e.eventName}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const rounds = Array.from({ length: draw.totalRounds }, (_, i) =>
    matches.filter((m) => m.roundIndex === i + 1).sort((a, b) => a.slot - b.slot)
  );

  return (
    <>
      <div className="page-head">
        <h1>{draw.eventName}</h1>
        <p>
          {draw.drawSize}-player draw · {draw.totalRounds} rounds ·{" "}
          {matches.filter((m) => m.winner != null).length} matches decided.
        </p>
      </div>

      <div className="filters">
        {events.map((e) => (
          <Link
            key={e.eventCode}
            to={`/draw/${e.eventCode}`}
            className={"chip" + (e.eventCode === code ? " is-on" : "")}
          >
            {e.eventName}
          </Link>
        ))}
      </div>

      <div className="bracket">
        {rounds.map((round, i) => (
          <div key={i} className="bracket-round">
            <h3>{roundName(i + 1, draw.totalRounds)}</h3>
            <div className="bracket-col">
              {round.map((m) => (
                <BracketMatch key={m.id} m={m} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {draw.prizeMoney.length > 0 && (
        <>
          <div className="section-head">
            <h2>Prize money</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Round reached</th>
                  <th className="num">Prize</th>
                </tr>
              </thead>
              <tbody>
                {draw.prizeMoney.map((p) => (
                  <tr key={p.roundCode}>
                    <td>{p.roundName}</td>
                    <td className="num">${p.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
