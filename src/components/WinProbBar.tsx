import type { Match } from "../types";
import { MODEL, matchOdds, ratingFor, sideName } from "../data";
import { liveWinProb } from "../model/tennis";
import { setsWon } from "../format";

/**
 * Win probability for a match — the pre-match model number, or a live figure
 * recomputed from the current set/game score once play is under way.
 */
export function WinProbBar({ m, compact = false }: { m: Match; compact?: boolean }) {
  const a = m.sides[0].players[0];
  const b = m.sides[1].players[0];
  if (!a || !b) return null;
  const ra = ratingFor(a.id);
  const rb = ratingFor(b.id);

  const bestOf = m.eventCode === "MS" ? 5 : 3;
  const pre = matchOdds(m.id);

  let p: number | null = null;
  let live = false;

  if (m.status === "live" && ra && rb) {
    // A's serve rate against B: A's own level, adjusted by how much better or
    // worse than the tour average B returns. Same formulation and the same
    // shrinkage target the model build used, so live and pre-match agree.
    const { meanRpw } = MODEL.tourMeans[m.tour];
    const clamp = (x: number) => Math.min(0.95, Math.max(0.05, x));
    const spwA = clamp(ra.spw - (rb.rpw - meanRpw));
    const spwB = clamp(rb.spw - (ra.rpw - meanRpw));
    const [sa, sb] = setsWon(m);
    const current = m.sets[m.sets.length - 1];
    const done =
      current &&
      ((Math.max(...current.games) >= 6 && Math.abs(current.games[0] - current.games[1]) >= 2) ||
        Math.max(...current.games) === 7);
    p = liveWinProb(spwA, spwB, {
      setsA: sa,
      setsB: sb,
      gamesA: done ? 0 : (current?.games[0] ?? 0),
      gamesB: done ? 0 : (current?.games[1] ?? 0),
      bestOf,
    });
    live = true;
  } else if (pre) {
    p = pre.p;
  }

  if (p == null) return null;
  const pct = Math.round(p * 100);

  return (
    <div className={"winprob" + (compact ? " is-compact" : "")}>
      <div className="winprob-bar" role="img" aria-label={`${pct}% chance ${sideName(m.sides[0])} wins`}>
        <div className="winprob-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="winprob-labels tiny">
        <span>
          <strong>{pct}%</strong> {sideName(m.sides[0])}
        </span>
        <span className="faint">
          {live ? "live" : "pre-match"}
          {pre && !pre.rated && !live ? " · low confidence" : ""}
        </span>
        <span>
          {sideName(m.sides[1])} <strong>{100 - pct}%</strong>
        </span>
      </div>
    </div>
  );
}
