import { Link } from "react-router-dom";
import {
  DRAWS,
  MATCHES,
  META,
  PLAYERS,
  applyLive,
  isDecided,
  longestMatches,
  seedReport,
  upsets,
  useLiveMatches,
} from "../data";
import { MatchCard } from "../components/MatchCard";
import { WeatherStrip } from "../components/WeatherStrip";
import { duration, roundLabel } from "../format";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Overview() {
  const live = useLiveMatches();
  const matches = applyLive(MATCHES, live);

  const liveNow = matches.filter((m) => m.status === "live");
  const done = matches.filter(isDecided);
  const recent = done
    .slice()
    .sort((a, b) => (b.epoch ?? 0) - (a.epoch ?? 0))
    .slice(0, 6);

  const seedsOut = [...seedReport("MS"), ...seedReport("WS")].filter((s) => s.out);
  const bigUpsets = upsets().slice(0, 5);
  const longest = longestMatches(5);

  return (
    <>
      <div className="page-head">
        <h1>US Open {META.year}</h1>
        <p>
          {META.venue}, {META.city} · {DRAWS.length} draws ·{" "}
          {matches.length} matches, {done.length} completed.
        </p>
      </div>

      <WeatherStrip />

      <div className="grid grid-4">
        <Stat
          label="Live now"
          value={String(liveNow.length)}
          note={liveNow.length ? "matches in progress" : "no play right now"}
        />
        <Stat label="Completed" value={String(done.length)} note={`of ${matches.length} scheduled`} />
        <Stat
          label="Seeds out"
          value={String(seedsOut.length)}
          note="across both singles draws"
        />
        <Stat label="Players" value={String(PLAYERS.length)} note="in the published draws" />
      </div>

      {liveNow.length > 0 && (
        <>
          <div className="section-head">
            <h2>On court now</h2>
            <Link to="/courts">Court board →</Link>
          </div>
          <div className="grid grid-2">
            {liveNow.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <h2>Latest results</h2>
        <Link to="/matches">All matches →</Link>
      </div>
      <div className="grid grid-2">
        {recent.map((m) => (
          <MatchCard key={m.id} m={m} />
        ))}
      </div>

      <div className="grid grid-2" style={{ marginTop: 30 }}>
        <div className="card card-pad">
          <div className="section-head" style={{ margin: "0 0 10px" }}>
            <h2>Seed carnage</h2>
          </div>
          {bigUpsets.length === 0 ? (
            <p className="muted small">No upsets flagged yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {bigUpsets.map((m) => {
                const w = m.winner ? m.sides[m.winner - 1] : null;
                const l = m.winner ? m.sides[m.winner === 1 ? 1 : 0] : null;
                return (
                  <Link key={m.id} to={`/matches/${m.id}`} className="row small">
                    <span className="badge badge-upset">{roundLabel(m)}</span>
                    <strong>{w?.players.map((p) => p.name).join("/")}</strong>
                    <span className="faint">def.</span>
                    <span>
                      {l?.players.map((p) => p.name).join("/")}
                      {l?.seed != null && <span className="faint"> ({l.seed})</span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
          <div className="provenance">
            Flagged by the official feed's own <code>upset</code> field.
          </div>
        </div>

        <div className="card card-pad">
          <div className="section-head" style={{ margin: "0 0 10px" }}>
            <h2>Marathon watch</h2>
          </div>
          {longest.length === 0 ? (
            <p className="muted small">No completed matches yet.</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {longest.map((m) => (
                <Link key={m.id} to={`/matches/${m.id}`} className="row small">
                  <span className="badge">{duration(m.duration)}</span>
                  <span className="nm">
                    {m.sides.map((s) => s.players.map((p) => p.name).join("/")).join(" v ")}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
