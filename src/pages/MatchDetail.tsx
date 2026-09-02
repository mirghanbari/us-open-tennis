import { Link, useParams } from "react-router-dom";
import {
  MATCHES,
  applyLive,
  getMatch,
  headToHead,
  matchStats,

  isDecided,
  sideName,
  useLiveMatches,
} from "../data";
import { ServeStatsTable } from "../components/ServeStatsTable";
import { dateET, duration, roundLabel, sideTag, timeET } from "../format";

export function MatchDetail() {
  const { id = "" } = useParams();
  const live = useLiveMatches();
  const base = getMatch(id);
  // Overlay live data by running the same patcher over just this match.
  const m = base ? applyLive([base], live)[0] : undefined;

  if (!m) return <div className="empty">Match not found.</div>;

  const decided = isDecided(m);
  const feeder = m.fedBy?.map((fid) => MATCHES.find((x) => x.id === fid));
  const next = m.feedsInto ? MATCHES.find((x) => x.id === m.feedsInto) : null;

  return (
    <>
      <div className="page-head">
        <div className="row tiny faint" style={{ marginBottom: 6 }}>
          <Link to={`/draw/${m.eventCode}`}>{m.eventName}</Link>
          <span>·</span>
          <span>{m.roundName}</span>
          {m.court && (
            <>
              <span>·</span>
              <span>{m.court}</span>
            </>
          )}
          {m.epoch && (
            <>
              <span>·</span>
              <span>
                {dateET(m.epoch)} {timeET(m.epoch)} ET
              </span>
            </>
          )}
        </div>
        <h1>{m.sides.map((s) => sideName(s)).join(" v ")}</h1>
        <div className="row" style={{ marginTop: 8 }}>
          {m.status === "live" && (
            <span className="badge badge-live">
              <span className="dot-live" /> LIVE
            </span>
          )}
          {m.upset && <span className="badge badge-upset">Upset</span>}
          {m.status === "retired" && <span className="badge">Retired</span>}
          {m.duration && <span className="badge">{duration(m.duration)}</span>}
          {m.broadcasts?.map((b) => (
            <span key={b.name} className="badge badge-tv">
              {b.name}
            </span>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              {m.sets.map((_, i) => (
                <th key={i} className="num">
                  Set {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.sides.map((side, i) => (
              <tr key={i}>
                <td>
                  <span className="flag">{side.players[0]?.nation ?? ""} </span>
                  {side.players.map((p, j) => (
                    <span key={p.id}>
                      {j > 0 && " / "}
                      <Link to={`/players/${p.id}`}>
                        <strong style={{ fontWeight: m.winner === i + 1 ? 700 : 500 }}>
                          {p.fullName}
                        </strong>
                      </Link>
                    </span>
                  ))}
                  {sideTag(side) && <span className="faint"> {sideTag(side)}</span>}
                  {m.winner === i + 1 && <span className="badge" style={{ marginLeft: 8 }}>W</span>}
                </td>
                {m.sets.map((s, j) => (
                  <td key={j} className="num">
                    {s.games[i]}
                    {s.tiebreak && <sup>{s.tiebreak[i]}</sup>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {m.setDurations.length > 0 && (
        <div className="provenance">
          Set durations: {m.setDurations.map((d) => `${d}m`).join(" · ")}
        </div>
      )}
      {(() => {
        const stats = matchStats(m.id);
        if (stats) {
          return (
            <>
              <div className="section-head">
                <h2>Serve statistics</h2>
              </div>
              <ServeStatsTable m={m} stats={stats} />
              <div className="provenance">
                From Tennismylife, which publishes the Sackmann-schema match data. Updated roughly
                daily rather than live
                {stats.tour === "wta"
                  ? "; the publisher notes WTA data is less reliable than ATP."
                  : "."}
              </div>
            </>
          );
        }
        if (decided) {
          return (
            <div className="provenance">
              Serve statistics not published for this match yet — Tennismylife updates roughly
              daily, so a recently finished match usually has none.
            </div>
          );
        }
        return (
          <div className="provenance">
            {m.status === "live"
              ? "Live serve statistics are not available from any free source; they appear once the match is published."
              : "Not started."}
          </div>
        );
      })()}

      {(() => {
        const h = headToHead(m.id);
        if (!h) return null;
        const total = h.player1.wins + h.player2.wins;
        return (
          <>
            <div className="section-head">
              <h2>Head to head</h2>
              <span className="tiny faint">
                {total === 0 ? "first meeting" : `${total} previous ${total === 1 ? "meeting" : "meetings"}`}
              </span>
            </div>
            <div className="card card-pad">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>{h.player1.name}</span>
                <strong className="mono" style={{ fontSize: "1.2rem" }}>
                  {h.player1.wins}–{h.player2.wins}
                </strong>
                <span>{h.player2.name}</span>
              </div>
              {h.meetings.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 12, boxShadow: "none" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th>Tournament</th>
                        <th>Surface</th>
                        <th>Round</th>
                        <th>Winner</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.meetings.map((r, i) => (
                        <tr key={i}>
                          <td className="faint">{r.year}</td>
                          <td>{r.tournament}</td>
                          <td className="faint">{r.surface}</td>
                          <td className="faint">{r.round}</td>
                          <td>
                            <strong>
                              {r.winner === "1" ? h.player1.name : h.player2.name}
                            </strong>
                          </td>
                          <td className="mono tiny">{r.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        );
      })()}

      <div className="grid grid-2" style={{ marginTop: 24 }}>
        <div className="card card-pad">
          <div className="stat-label">Route into this match</div>
          {feeder && feeder.some(Boolean) ? (
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {feeder.map((f) =>
                f ? (
                  <Link key={f.id} to={`/matches/${f.id}`} className="small">
                    <span className="faint">{roundLabel(f)}: </span>
                    {f.sides.map((s) => sideName(s)).join(" v ")}
                  </Link>
                ) : null
              )}
            </div>
          ) : (
            <p className="muted small" style={{ marginTop: 8 }}>
              Opening round — both players entered the draw here.
            </p>
          )}
        </div>
        <div className="card card-pad">
          <div className="stat-label">Winner advances to</div>
          {next ? (
            <Link to={`/matches/${next.id}`} className="small" style={{ display: "block", marginTop: 8 }}>
              <span className="faint">{roundLabel(next)}: </span>
              {next.sides.map((s) => sideName(s)).join(" v ")}
            </Link>
          ) : (
            <p className="muted small" style={{ marginTop: 8 }}>
              This is the final.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
