import { Link } from "react-router-dom";
import {
  MATCHES,
  applyLive,
  longestMatches,
  nationsRemaining,
  prizeMoneyLeaders,
  publishedEvents,
  seedReport,
  serveTotals,
  sideName,
  upsets,
  useLiveMatches,
} from "../data";
import { FavoriteStar } from "../components/FavoriteStar";
import { duration, money, roundLabel } from "../format";
import { useState } from "react";

export function Stats() {
  const live = useLiveMatches();
  const matches = applyLive(MATCHES, live);
  const singles = publishedEvents().filter((e) => e.eventCode === "MS" || e.eventCode === "WS");

  const leaders = prizeMoneyLeaders(20);
  const marathons = longestMatches(10);
  const shocks = upsets();
  const nations = nationsRemaining().filter((n) => n.alive > 0).slice(0, 12);

  // Retirements and walkovers — a recurring US Open storyline in the heat.
  const attrition = matches.filter((m) => m.status === "retired" || m.status === "walkover");

  return (
    <>
      <div className="page-head">
        <h1>Stats</h1>
        <p>
          Everything derivable from the official draw and ESPN. Serve-level statistics (aces,
          double faults, break points) are not published by either source and are noted as such
          below.
        </p>
      </div>

      <ServeLeaders />

      <div className="section-head">
        <h2>Seeds</h2>
      </div>
      <div className="grid grid-2">
        {singles.map((e) => {
          const seeds = seedReport(e.eventCode);
          const out = seeds.filter((s) => s.out);
          return (
            <div key={e.eventCode} className="card card-pad">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{e.eventName}</strong>
                <span className="badge">
                  {seeds.length - out.length} of {seeds.length} alive
                </span>
              </div>
              <div className="stack" style={{ gap: 4, marginTop: 10 }}>
                {seeds.map((s) => (
                  <div key={s.player.id} className="row small">
                    <span className={"badge " + (s.out ? "" : "badge-seed")}>{s.seed}</span>
                    <Link
                      to={`/players/${s.player.id}`}
                      className={s.out ? "faint" : ""}
                      style={{ textDecoration: s.out ? "line-through" : "none" }}
                    >
                      {s.player.fullName}
                    </Link>
                    {s.out && s.lostTo && (
                      <span className="tiny faint">
                        out {roundLabel(s.lostTo)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-head">
        <h2>Prize money</h2>
        <span className="tiny faint">guaranteed so far, all events</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th>Player</th>
              <th>Nation</th>
              <th>Events</th>
              <th className="num">Earned</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((row) => (
              <tr key={row.player.id}>
                <td>
                  <FavoriteStar id={row.player.id} label={row.player.fullName} />
                </td>
                <td>
                  <Link to={`/players/${row.player.id}`}>
                    <strong>{row.player.fullName}</strong>
                  </Link>
                </td>
                <td className="faint">{row.player.nation}</td>
                <td className="faint tiny">{row.events.join(", ")}</td>
                <td className="num">
                  <strong>{money(row.amount)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="provenance">
        Computed from the official per-round prize-money table and the round each player exited
        in. A player still alive shows the amount already banked by reaching their current round.
      </div>

      <div className="grid grid-2" style={{ marginTop: 30 }}>
        <div className="card card-pad">
          <div className="section-head" style={{ margin: "0 0 10px" }}>
            <h2>Longest matches</h2>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {marathons.map((m) => (
              <Link key={m.id} to={`/matches/${m.id}`} className="row small">
                <span className="badge">{duration(m.duration)}</span>
                <span className="nm">{m.sides.map((s) => sideName(s)).join(" v ")}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card card-pad">
          <div className="section-head" style={{ margin: "0 0 10px" }}>
            <h2>Nations still alive</h2>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {nations.map((n) => (
              <div key={n.nation} className="row small" style={{ justifyContent: "space-between" }}>
                <span className="flag">{n.nation}</span>
                <span className="mono faint">
                  {n.alive} <span className="tiny">of {n.total}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="provenance">Singles only; “alive” means no completed loss yet.</div>
        </div>
      </div>

      <div className="section-head">
        <h2>Upsets</h2>
        <span className="tiny faint">{shocks.length} flagged</span>
      </div>
      {shocks.length === 0 ? (
        <div className="empty">No upsets flagged yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Round</th>
                <th>Winner</th>
                <th>Beat</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {shocks.map((m) => {
                const w = m.winner ? m.sides[m.winner - 1] : null;
                const l = m.winner ? m.sides[m.winner === 1 ? 1 : 0] : null;
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="badge badge-upset">{roundLabel(m)}</span>
                    </td>
                    <td>
                      <Link to={`/matches/${m.id}`}>
                        <strong>{w ? sideName(w) : ""}</strong>
                      </Link>
                    </td>
                    <td className="faint">
                      {l ? sideName(l) : ""}
                      {l?.seed != null && ` (${l.seed})`}
                    </td>
                    <td className="mono tiny">
                      {m.sets
                        .map(
                          (s) =>
                            `${s.games[0]}-${s.games[1]}` +
                            (s.tiebreak ? `(${Math.min(...s.tiebreak)})` : "")
                        )
                        .join(" ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {attrition.length > 0 && (
        <>
          <div className="section-head">
            <h2>Retirements &amp; walkovers</h2>
          </div>
          <div className="grid grid-3">
            {attrition.map((m) => (
              <Link key={m.id} to={`/matches/${m.id}`} className="card card-pad small">
                <div className="row">
                  <span className="badge">{m.status === "retired" ? "Retired" : "Walkover"}</span>
                  <span className="faint tiny">{roundLabel(m)}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {m.sides.map((s) => sideName(s)).join(" v ")}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}

type Metric = "aces" | "acesPerMatch" | "doubleFaults" | "firstServePct" | "bpSavedPct";

/**
 * `qualify` guards rate metrics against meaningless small samples. It gates on
 * the DENOMINATOR, not on matches played: early in a tournament every player
 * has exactly one match, so a matches-played threshold empties the board
 * entirely, while "100% break points saved" off a single break point faced is
 * noise either way. Counting stats need no guard.
 */
const METRICS: {
  key: Metric;
  label: string;
  format: (r: any) => string;
  qualify?: (r: any) => boolean;
  note?: string;
}[] = [
  { key: "aces", label: "Aces", format: (r) => String(r.aces) },
  {
    key: "acesPerMatch",
    label: "Aces / match",
    format: (r) => r.acesPerMatch.toFixed(1),
  },
  { key: "doubleFaults", label: "Double faults", format: (r) => String(r.doubleFaults) },
  {
    key: "firstServePct",
    label: "1st serve %",
    format: (r) => (r.firstServePct != null ? `${r.firstServePct}%` : "—"),
    qualify: (r) => r.servePoints >= 50,
    note: "minimum 50 service points",
  },
  {
    key: "bpSavedPct",
    label: "Break points saved",
    format: (r) => (r.bpSavedPct != null ? `${r.bpSavedPct}%` : "—"),
    qualify: (r) => r.bpFaced >= 5,
    note: "minimum 5 break points faced",
  },
];

function ServeLeaders() {
  const [metric, setMetric] = useState<Metric>("aces");
  const totals = serveTotals();
  const spec = METRICS.find((m) => m.key === metric)!;

  if (totals.length === 0) {
    return (
      <>
        <div className="section-head">
          <h2>Serve leaders</h2>
        </div>
        <div className="empty">
          No serve statistics published yet for this tournament.
        </div>
      </>
    );
  }

  // Supporting columns, minus whichever one is already the selected metric —
  // otherwise the board shows the same number twice under two headings.
  const CONTEXT = [
    { key: "aces", label: "Aces", format: (r: any) => String(r.aces) },
    { key: "doubleFaults", label: "DF", format: (r: any) => String(r.doubleFaults) },
    {
      key: "firstServePct",
      label: "1st in",
      format: (r: any) => (r.firstServePct != null ? `${r.firstServePct}%` : "—"),
    },
    {
      key: "bpSavedPct",
      label: "BP saved",
      format: (r: any) => (r.bpSavedPct != null ? `${r.bpSavedPct}%` : "—"),
    },
  ];
  const context = CONTEXT.filter((c) => c.key !== metric);

  const eligible = totals
    .filter((r) => (spec.qualify ? spec.qualify(r) : true))
    .filter((r) => (r as any)[metric] != null);
  const rows = eligible
    .sort((a, b) => ((b as any)[metric] as number) - ((a as any)[metric] as number))
    .slice(0, 15);

  return (
    <>
      <div className="section-head">
        <h2>Serve leaders</h2>
        <span className="tiny faint">
          {spec.note ? `${eligible.length} qualify · ${spec.note}` : `${totals.length} players`}
        </span>
      </div>
      <div className="filters">
        {METRICS.map((m) => (
          <button
            key={m.key}
            className={"chip" + (m.key === metric ? " is-on" : "")}
            onClick={() => setMetric(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          No player meets the {spec.note} threshold yet.
        </div>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th>Player</th>
              <th className="num">M</th>
              <th className="num">{spec.label}</th>
              {context.map((c) => (
                <th key={c.key} className="num">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.player.id}>
                <td>
                  <FavoriteStar id={r.player.id} label={r.player.fullName} />
                </td>
                <td>
                  <Link to={`/players/${r.player.id}`}>
                    <strong>{r.player.fullName}</strong>
                  </Link>{" "}
                  <span className="flag">{r.player.nation}</span>
                </td>
                <td className="num faint">{r.matches}</td>
                <td className="num">
                  <strong>{spec.format(r)}</strong>
                </td>
                {context.map((c) => (
                  <td key={c.key} className="num faint">
                    {c.format(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div className="provenance">
        From Tennismylife (Sackmann schema), updated roughly daily — a match that finished in the
        last few hours is usually not counted yet. Percentages are computed from summed counts,
        not by averaging per-match rates. Rate boards carry a minimum sample so a single break point can't top the table.
      </div>
    </>
  );
}
