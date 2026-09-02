import type { Match, MatchStats } from "../types";
import { sideName } from "../data";

const ROWS: { label: string; get: (s: MatchStats["sides"][0]) => string }[] = [
  { label: "Aces", get: (s) => (s.aces ?? "—").toString() },
  { label: "Double faults", get: (s) => (s.doubleFaults ?? "—").toString() },
  {
    label: "1st serve in",
    get: (s) =>
      s.firstServePct != null ? `${s.firstServePct}% (${s.firstIn}/${s.servePoints})` : "—",
  },
  { label: "1st serve points won", get: (s) => (s.firstWonPct != null ? `${s.firstWonPct}%` : "—") },
  {
    label: "2nd serve points won",
    get: (s) => (s.secondWonPct != null ? `${s.secondWonPct}%` : "—"),
  },
  { label: "Service games", get: (s) => (s.serveGames ?? "—").toString() },
  {
    label: "Break points saved",
    get: (s) => (s.bpFaced ? `${s.bpSaved}/${s.bpFaced} (${s.bpSavedPct}%)` : "—"),
  },
];

/** Side-by-side serve comparison for a completed match. */
export function ServeStatsTable({ m, stats }: { m: Match; stats: MatchStats }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{sideName(m.sides[0])}</th>
            <th style={{ textAlign: "center" }} />
            <th style={{ textAlign: "right" }}>{sideName(m.sides[1])}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <td>
                <strong>{row.get(stats.sides[0])}</strong>
              </td>
              <td style={{ textAlign: "center" }} className="tiny faint">
                {row.label}
              </td>
              <td style={{ textAlign: "right" }}>
                <strong>{row.get(stats.sides[1])}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
