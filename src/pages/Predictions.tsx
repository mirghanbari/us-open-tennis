import { useState } from "react";
import { Link } from "react-router-dom";
import {
  MATCHES,
  MODEL,
  applyLive,
  getPlayer,
  matchOdds,
  publishedEvents,
  ratingFor,
  titleOdds,
  useLiveMatches,
} from "../data";
import { FavoriteStar } from "../components/FavoriteStar";
import { WinProbBar } from "../components/WinProbBar";
import { MatchCard } from "../components/MatchCard";
import type { EventCode } from "../types";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function OddsTable({ code }: { code: EventCode }) {
  const rows = titleOdds(code).slice(0, 16);
  if (rows.length === 0) return <div className="empty">No odds for this draw.</div>;
  const max = rows[0].title || 1;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th />
            <th>Player</th>
            <th className="num">Elo</th>
            <th className="num">Title</th>
            <th style={{ width: 120 }} />
            <th className="num">Final</th>
            <th className="num">Semi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = getPlayer(r.playerId);
            const rating = ratingFor(r.playerId);
            if (!p) return null;
            return (
              <tr key={r.playerId}>
                <td>
                  <FavoriteStar id={p.id} label={p.fullName} />
                </td>
                <td>
                  <Link to={`/players/${p.id}`}>
                    <strong>{p.fullName}</strong>
                  </Link>{" "}
                  <span className="flag">{p.nation}</span>
                  {p.seed != null && <span className="faint tiny"> ({p.seed})</span>}
                </td>
                <td className="num faint">{rating?.hardElo ?? "—"}</td>
                <td className="num">
                  <strong>{pct(r.title)}</strong>
                </td>
                <td>
                  <span
                    className="odds-bar"
                    style={{ width: `${Math.max(2, (r.title / max) * 100)}%` }}
                  />
                </td>
                <td className="num faint">{pct(r.final)}</td>
                <td className="num faint">{pct(r.semi)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Predictions() {
  const live = useLiveMatches();
  const matches = applyLive(MATCHES, live);
  const events = publishedEvents().filter((e) => e.eventCode === "MS" || e.eventCode === "WS");
  const [code, setCode] = useState<EventCode>(events[0]?.eventCode ?? "MS");

  const bt = MODEL.backtest;
  const slam = bt.grandSlam;

  // Upcoming matches the model has an opinion on, soonest first.
  const upcoming = matches
    .filter((m) => m.winner == null && matchOdds(m.id))
    .sort((a, b) => (a.startEpoch ?? Infinity) - (b.startEpoch ?? Infinity))
    .slice(0, 8);

  const liveNow = matches.filter((m) => m.status === "live" && ratingFor(m.sides[0].players[0]?.id ?? ""));

  return (
    <>
      <div className="page-head">
        <h1>Predictions</h1>
        <p>
          A surface-weighted Elo blended with a serve-based point model, trained on{" "}
          {MODEL.historyMatches.toLocaleString()} matches from {MODEL.trainedFrom} to{" "}
          {MODEL.trainedThrough}, then simulated through the draw{" "}
          {MODEL.sims.toLocaleString()} times.
        </p>
      </div>

      {liveNow.length > 0 && (
        <>
          <div className="section-head">
            <h2>Live win probability</h2>
          </div>
          <div className="grid grid-2">
            {liveNow.map((m) => (
              <div key={m.id} className="card card-pad">
                <MatchCard m={m} />
                <WinProbBar m={m} />
              </div>
            ))}
          </div>
          <div className="provenance">
            Recomputed from the current set and game score. No free feed publishes who is serving
            or the game score, so this is accurate at game granularity — it cannot see “30–40 on
            serve”.
          </div>
        </>
      )}

      <div className="section-head">
        <h2>Title odds</h2>
        <span className="tiny faint">{MODEL.sims.toLocaleString()} simulations</span>
      </div>
      <div className="filters">
        {events.map((e) => (
          <button
            key={e.eventCode}
            className={"chip" + (e.eventCode === code ? " is-on" : "")}
            onClick={() => setCode(e.eventCode)}
          >
            {e.eventName}
          </button>
        ))}
      </div>
      <OddsTable code={code} />
      <div className="provenance">
        Completed matches are never re-simulated — the draw is replayed forward from the real
        results, so odds reflect who is actually still in.
      </div>

      {upcoming.length > 0 && (
        <>
          <div className="section-head">
            <h2>Next matches</h2>
            <Link to="/matches">All matches →</Link>
          </div>
          <div className="grid grid-2">
            {upcoming.map((m) => (
              <div key={m.id} className="card card-pad">
                <MatchCard m={m} />
                <WinProbBar m={m} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-head">
        <h2>How well does it actually do?</h2>
      </div>
      <div className="grid grid-2">
        <div className="card card-pad">
          <div className="stat-label">Grand Slam matches</div>
          <p className="small muted" style={{ marginTop: 4 }}>
            The matches this dashboard actually predicts. Held-out test set:{" "}
            {slam.blend.n.toLocaleString()} slam matches from {bt.testFrom} onward.
          </p>
          <div className="table-wrap" style={{ marginTop: 10, boxShadow: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Accuracy</th>
                  <th className="num">Log-loss</th>
                  <th className="num">Brier</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Elo + serve blend</strong>
                  </td>
                  <td className="num">
                    <strong>{pct(slam.blend.accuracy)}</strong>
                  </td>
                  <td className="num">
                    <strong>{slam.blend.logLoss.toFixed(4)}</strong>
                  </td>
                  <td className="num">{slam.blend.brier.toFixed(4)}</td>
                </tr>
                <tr>
                  <td className="faint">Elo only</td>
                  <td className="num faint">{pct(slam.elo.accuracy)}</td>
                  <td className="num faint">{slam.elo.logLoss.toFixed(4)}</td>
                  <td className="num faint">{slam.elo.brier.toFixed(4)}</td>
                </tr>
                <tr>
                  <td className="faint">Ranking baseline</td>
                  <td className="num faint">{pct(slam.rank.accuracy)}</td>
                  <td className="num faint">{slam.rank.logLoss.toFixed(4)}</td>
                  <td className="num faint">{slam.rank.brier.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="provenance">
            ATP slams {pct(slam.atp.accuracy)} · WTA slams {pct(slam.wta.accuracy)}.
          </div>
        </div>

        <div className="card card-pad">
          <div className="stat-label">All matches, every level</div>
          <p className="small muted" style={{ marginTop: 4 }}>
            The same model across {bt.overall.blend.n.toLocaleString()} matches of all tiers. It
            does markedly worse here — ATP 250s and lower-tier draws are far less predictable than
            slams, and this is the honest wider number.
          </p>
          <div className="table-wrap" style={{ marginTop: 10, boxShadow: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Accuracy</th>
                  <th className="num">Log-loss</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Elo + serve blend</strong>
                  </td>
                  <td className="num">
                    <strong>{pct(bt.overall.blend.accuracy)}</strong>
                  </td>
                  <td className="num">
                    <strong>{bt.overall.blend.logLoss.toFixed(4)}</strong>
                  </td>
                </tr>
                <tr>
                  <td className="faint">Ranking baseline</td>
                  <td className="num faint">{pct(bt.overall.rank.accuracy)}</td>
                  <td className="num faint">{bt.overall.rank.logLoss.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h2>Method</h2>
      </div>
      <div className="card card-pad small">
        <p>
          <strong>Elo</strong> is trained chronologically over every match since{" "}
          {MODEL.trainedFrom}, with a decaying K-factor so a player's rating settles as their
          record grows. A separate hard-court Elo is kept and blended with the overall rating,
          weighted up once both players have a real hard-court record.
        </p>
        <p style={{ marginTop: 8 }}>
          <strong>The serve model</strong> takes each player's serve- and return-points-won rates,
          decayed with a one-year half-life and shrunk toward the tour average, then adjusts each
          player's serve rate by how well their opponent returns. Those two point probabilities
          feed the standard point → game → set → match hierarchy, which has an exact closed form.
        </p>
        <p style={{ marginTop: 8 }}>
          <strong>The blend</strong> is {Math.round(MODEL.eloWeight * 100)}% Elo,{" "}
          {Math.round((1 - MODEL.eloWeight) * 100)}% serve model. That weight was chosen on{" "}
          {bt.validationYear} as a validation year and then evaluated on {bt.testFrom} onward,
          which the tuning never saw. Every prediction in the backtest was made before that match
          was used to update the ratings, so nothing leaks backwards.
        </p>
        <p style={{ marginTop: 8 }} className="muted">
          <strong>Limits.</strong> No injury, fatigue, travel or weather input. Head-to-head is
          shown on match pages but is not in the model. A player with no tour-level history falls
          back to Elo's newcomer prior rather than a measured rating. Doubles are not modelled.
        </p>
      </div>
    </>
  );
}
