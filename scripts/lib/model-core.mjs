// The rating engine: Elo (overall + per-surface) and a decayed serve/return
// profile per player, both updated strictly chronologically so that any
// prediction only ever uses information available before that match.
import { matchProbFromServe, eloExpected } from "./tennis-math.mjs";

const DAY = 86_400_000;
const SERVE_HALF_LIFE = 365 * DAY; // recent form dominates, older data fades
const SHRINK_POINTS = 500; // serve points before a player's own rate is trusted

export function createEngine() {
  const elo = new Map(); // name -> rating
  const eloN = new Map(); // name -> matches played (drives the K factor)
  const surfElo = new Map(); // `${surface}|${name}` -> rating
  const surfN = new Map();
  const serve = new Map(); // name -> decayed serve/return accumulators

  // Tour-wide averages, tracked online so the shrinkage target is era-correct
  // (serve dominance drifts over decades).
  const tourAvg = { atp: { won: 0, pts: 0 }, wta: { won: 0, pts: 0 } };

  const getElo = (n) => elo.get(n) ?? 1500;
  const getSurfElo = (s, n) => surfElo.get(`${s}|${n}`) ?? 1500;

  /** Sackmann's decaying K: volatile early, stable once a player has a record. */
  const kFactor = (n) => 250 / Math.pow(n + 5, 0.4);

  function serveProfile(name) {
    return serve.get(name) ?? { won: 0, pts: 0, rWon: 0, rPts: 0, last: 0 };
  }

  function decay(p, now) {
    if (!p.last) return p;
    const f = Math.pow(0.5, (now - p.last) / SERVE_HALF_LIFE);
    return { won: p.won * f, pts: p.pts * f, rWon: p.rWon * f, rPts: p.rPts * f, last: now };
  }

  /** Shrunk serve- and return-points-won rates for a player, as of `now`. */
  function rates(name, tour, now) {
    const avg = tourAvg[tour];
    const meanSpw = avg.pts > 0 ? avg.won / avg.pts : 0.62;
    const meanRpw = 1 - meanSpw;
    const p = decay(serveProfile(name), now);
    const spw = (p.won + SHRINK_POINTS * meanSpw) / (p.pts + SHRINK_POINTS);
    const rpw = (p.rWon + SHRINK_POINTS * meanRpw) / (p.rPts + SHRINK_POINTS);
    return { spw, rpw, meanSpw, meanRpw, servePoints: p.pts };
  }

  /**
   * Probability that `a` beats `b`. Returns the Elo and serve components too,
   * so the blend weight can be tuned and the two compared.
   */
  function predict(a, b, { surface, tour, bestOf, date }) {
    // --- Elo, blending overall with surface-specific ---
    const ea = getElo(a);
    const eb = getElo(b);
    const sa = getSurfElo(surface, a);
    const sb = getSurfElo(surface, b);
    // Only lean on surface Elo once there's a surface record to lean on.
    const na = surfN.get(`${surface}|${a}`) ?? 0;
    const nb = surfN.get(`${surface}|${b}`) ?? 0;
    const surfWeight = Math.min(na, nb) >= 10 ? 0.5 : 0.2;
    const blendA = (1 - surfWeight) * ea + surfWeight * sa;
    const blendB = (1 - surfWeight) * eb + surfWeight * sb;
    const pElo = eloExpected(blendA, blendB);

    // --- Serve model ---
    const ra = rates(a, tour, date);
    const rb = rates(b, tour, date);
    // A's serve rate against B specifically: A's own level, adjusted by how
    // much better or worse than average B returns.
    const spwA = clamp(ra.spw - (rb.rpw - ra.meanRpw));
    const spwB = clamp(rb.spw - (ra.rpw - rb.meanRpw));
    const pServe = matchProbFromServe(spwA, spwB, bestOf);

    return { pElo, pServe, eloA: blendA, eloB: blendB, spwA, spwB };
  }

  function update(m) {
    const { winner, loser, surface, tour, date } = m;

    // --- Elo ---
    const w = getElo(winner);
    const l = getElo(loser);
    const expW = eloExpected(w, l);
    const kw = kFactor(eloN.get(winner) ?? 0);
    const kl = kFactor(eloN.get(loser) ?? 0);
    elo.set(winner, w + kw * (1 - expW));
    elo.set(loser, l + kl * (0 - (1 - expW)));
    eloN.set(winner, (eloN.get(winner) ?? 0) + 1);
    eloN.set(loser, (eloN.get(loser) ?? 0) + 1);

    if (surface) {
      const kw2 = `${surface}|${winner}`;
      const kl2 = `${surface}|${loser}`;
      const sw = getSurfElo(surface, winner);
      const sl = getSurfElo(surface, loser);
      const expSW = eloExpected(sw, sl);
      surfElo.set(kw2, sw + kFactor(surfN.get(kw2) ?? 0) * (1 - expSW));
      surfElo.set(kl2, sl + kFactor(surfN.get(kl2) ?? 0) * -(1 - expSW));
      surfN.set(kw2, (surfN.get(kw2) ?? 0) + 1);
      surfN.set(kl2, (surfN.get(kl2) ?? 0) + 1);
    }

    // --- Serve / return profiles ---
    if (m.wSvpt && m.lSvpt && m.wServeWon != null && m.lServeWon != null) {
      const pw = decay(serveProfile(winner), date);
      const pl = decay(serveProfile(loser), date);
      // Serve points won on own serve; return points won = opponent's serve
      // points they failed to win.
      pw.won += m.wServeWon;
      pw.pts += m.wSvpt;
      pw.rWon += m.lSvpt - m.lServeWon;
      pw.rPts += m.lSvpt;
      pl.won += m.lServeWon;
      pl.pts += m.lSvpt;
      pl.rWon += m.wSvpt - m.wServeWon;
      pl.rPts += m.wSvpt;
      pw.last = date;
      pl.last = date;
      serve.set(winner, pw);
      serve.set(loser, pl);

      const avg = tourAvg[tour];
      if (avg) {
        avg.won += m.wServeWon + m.lServeWon;
        avg.pts += m.wSvpt + m.lSvpt;
      }
    }
  }

  const clamp = (x) => Math.min(0.95, Math.max(0.05, x));

  /** Tour-average serve/return rates — the shrinkage target, era-correct. */
  function tourMeans(tour) {
    const avg = tourAvg[tour];
    const meanSpw = avg && avg.pts > 0 ? avg.won / avg.pts : 0.62;
    return { meanSpw, meanRpw: 1 - meanSpw };
  }

  return { predict, update, getElo, getSurfElo, rates, tourMeans, elo, eloN, surfElo, surfN };
}

export { matchProbFromServe };
